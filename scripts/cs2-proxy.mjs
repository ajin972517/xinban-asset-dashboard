import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import lodash from 'lodash';

const { isArray } = lodash;

const DEFAULT_PORT = 31777;
const INVENTORY_CACHE_MS = 10 * 60_000;
const PRICE_CACHE_MS = 60_000;
const PRICE_RATE_LIMIT_MS = 60_000;
const PRICE_FALLBACK_CACHE_MS = 10 * 60_000;
const MARKET_CACHE_MS = 5 * 60_000;
const STEAM_NEWS_CACHE_MS = 30 * 60_000;
const MAX_INVENTORY_PAGES = 20;
const MAX_PRICE_ITEMS = 500;

const inventoryCache = new Map();
const inventoryAttemptDates = new Map();
const priceCache = new Map();
const itemPriceCache = new Map();
let lastPriceRequestAt = 0;
let marketCache = null;
let newsCache = null;

const loadLocalEnv = () => {
  const envPath = resolve(process.cwd(), '.env.local');
  try {
    const content = readFileSync(envPath, 'utf8');
    content.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex <= 0) return;
      const key = trimmed.slice(0, separatorIndex).trim();
      if (!key || process.env[key] !== undefined) return;
      let value = trimmed.slice(separatorIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    });
  } catch {
    // .env.local is optional. Inventory can still be loaded without SteamDT pricing.
  }
};

loadLocalEnv();

const getAllowedOrigins = () => {
  const configured = String(process.env.CS2_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([
    'http://127.0.0.1:3000',
    'http://localhost:3000',
    'http://127.0.0.1:3001',
    'http://localhost:3001',
    'http://127.0.0.1:31888',
    'http://localhost:31888',
    ...configured
  ]);
};

const sendJson = (response, statusCode, payload, origin) => {
  if (origin && getAllowedOrigins().has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
};

const readJsonBody = async (request) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('请求内容过大');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const normalizeSteamId = (value) => {
  const input = String(value || '').trim();
  const profileMatch = input.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
  const steamId = profileMatch?.[1] || input;
  return /^\d{17}$/.test(steamId) ? steamId : '';
};

const chinaDate = (timestamp = Date.now()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(timestamp));

const nextChinaDayStart = (dateText) => new Date(`${dateText}T16:00:00.000Z`).getTime();

const withDailyRefreshState = (inventory, today, patch = {}) => ({
  ...inventory,
  refreshPolicy: 'daily',
  refreshDate: today,
  refreshAvailable: false,
  nextRefreshAt: nextChinaDayStart(today),
  ...patch
});

const getDescriptionKey = (classId, instanceId) => `${classId || ''}_${instanceId || '0'}`;

const fetchSteamInventoryPage = async (steamId, startAssetId = '') => {
  const params = new URLSearchParams({ l: 'schinese', count: '2000' });
  if (startAssetId) params.set('start_assetid', startAssetId);
  const url = `https://steamcommunity.com/inventory/${steamId}/730/2?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'FundDashboard-CS2-Inventory/1.0'
    },
    signal: AbortSignal.timeout(20_000)
  });
  if (response.status === 403) throw new Error('Steam 库存不可见，请将游戏详情和库存设为公开');
  if (response.status === 429) throw new Error('Steam 请求过于频繁，请稍后再试');
  if (!response.ok) throw new Error(`Steam 库存请求失败（${response.status}）`);
  const payload = await response.json();
  if (!payload?.success) throw new Error('Steam 未返回可用库存，请确认 SteamID64 和隐私设置');
  return payload;
};

const fetchSteamInventory = async (steamId) => {
  const today = chinaDate();
  const cached = inventoryCache.get(steamId);
  if (cached && chinaDate(Number(cached.data?.fetchedAt) || 0) === today) {
    return withDailyRefreshState(cached.data, today);
  }

  const attemptedToday = inventoryAttemptDates.get(steamId);
  if (attemptedToday?.date === today) {
    if (!cached?.data) throw new Error('Steam 今日库存刷新已经尝试过，请明日再试');
    return withDailyRefreshState(cached.data, today, {
      stale: true,
      staleReason: attemptedToday.error || 'Steam 今日库存刷新未成功',
      warning: `Steam 今日库存刷新已尝试但未成功（${attemptedToday.error || '访问受限'}），本地开发服务将在明日再试。`
    });
  }

  inventoryAttemptDates.set(steamId, { date: today, attemptedAt: Date.now() });

  try {
    const assets = [];
    const descriptions = new Map();
    const assetProperties = new Map();
    let startAssetId = '';
    let totalInventoryCount = 0;

    for (let page = 0; page < MAX_INVENTORY_PAGES; page += 1) {
      const payload = await fetchSteamInventoryPage(steamId, startAssetId);
      totalInventoryCount = Number(payload.total_inventory_count) || totalInventoryCount;
      (isArray(payload.assets) ? payload.assets : []).forEach((asset) => assets.push(asset));
      (isArray(payload.descriptions) ? payload.descriptions : []).forEach((description) => {
        descriptions.set(getDescriptionKey(description.classid, description.instanceid), description);
      });
      (isArray(payload.asset_properties) ? payload.asset_properties : []).forEach((entry) => {
        assetProperties.set(String(entry.assetid || ''), isArray(entry.asset_properties) ? entry.asset_properties : []);
      });
      if (!payload.more_items || !payload.last_assetid) break;
      startAssetId = String(payload.last_assetid);
    }

    const items = assets.map((asset) => {
      const description = descriptions.get(getDescriptionKey(asset.classid, asset.instanceid)) || {};
      const properties = assetProperties.get(String(asset.assetid || '')) || [];
      const wearProperty = properties.find((property) => Number(property?.propertyid) === 2);
      const patternProperty = properties.find((property) => Number(property?.propertyid) === 1);
      const floatWear = Number(wearProperty?.float_value);
      const paintSeed = Number(patternProperty?.int_value);
      const inspectAction = (isArray(description.actions) ? description.actions : []).find((action) =>
        String(action?.link || '').includes('steam://rungame/730')
      );
      const inspectUrl = inspectAction?.link
        ? String(inspectAction.link)
            .replace('%owner_steamid%', steamId)
            .replace('%assetid%', String(asset.assetid || ''))
        : '';
      const iconUrl = description.icon_url
        ? `https://community.cloudflare.steamstatic.com/economy/image/${description.icon_url}/360fx360f`
        : '';

      return {
        assetId: String(asset.assetid || ''),
        classId: String(asset.classid || ''),
        instanceId: String(asset.instanceid || ''),
        amount: Math.max(1, Number(asset.amount) || 1),
        name: String(description.name || description.market_name || description.market_hash_name || '未知饰品'),
        marketName: String(description.market_name || ''),
        marketHashName: String(description.market_hash_name || ''),
        type: String(description.type || ''),
        iconUrl,
        tradable: Number(description.tradable) === 1,
        marketable: Number(description.marketable) === 1,
        commodity: Number(description.commodity) === 1,
        nameColor: description.name_color ? `#${description.name_color}` : '',
        backgroundColor: description.background_color ? `#${description.background_color}` : '',
        inspectUrl,
        floatWear: Number.isFinite(floatWear) ? floatWear : null,
        paintSeed: Number.isFinite(paintSeed) ? paintSeed : null,
        tags: (isArray(description.tags) ? description.tags : []).map((tag) => ({
          category: String(tag.category || ''),
          internalName: String(tag.internal_name || ''),
          name: String(tag.localized_tag_name || tag.name || '')
        }))
      };
    });

    const result = withDailyRefreshState(
      {
        steamId,
        totalInventoryCount: totalInventoryCount || items.reduce((sum, item) => sum + item.amount, 0),
        items,
        fetchedAt: Date.now()
      },
      today
    );
    inventoryCache.set(steamId, { cachedAt: Date.now(), data: result });
    return result;
  } catch (error) {
    inventoryAttemptDates.set(steamId, {
      date: today,
      attemptedAt: Date.now(),
      error: error?.message || 'Steam 访问受限'
    });
    if (!cached?.data) throw error;
    return withDailyRefreshState(cached.data, today, {
      stale: true,
      staleReason: error?.message || 'Steam 访问受限',
      warning: `Steam 今日库存刷新未成功（${error?.message || '访问受限'}），已使用本地缓存；明日再尝试。`
    });
  }
};

const fetchSteamDtPrices = async (marketHashNames) => {
  const apiKey = String(process.env.STEAMDT_API_KEY || '').trim();
  if (!apiKey) throw new Error('本地服务尚未配置 STEAMDT_API_KEY');

  const names = Array.from(
    new Set(
      marketHashNames
        .map((name) => String(name || '').trim())
        .filter(Boolean)
        .slice(0, MAX_PRICE_ITEMS)
    )
  );
  if (names.length === 0) return { data: [], fetchedAt: Date.now() };

  const cacheKey = names.slice().sort().join('\u001f');
  const cached = priceCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < PRICE_CACHE_MS) return cached.data;

  const now = Date.now();
  const reusableEntries = names
    .map((name) => itemPriceCache.get(name))
    .filter((entry) => entry && now - entry.cachedAt < PRICE_FALLBACK_CACHE_MS);
  if (lastPriceRequestAt && now - lastPriceRequestAt < PRICE_RATE_LIMIT_MS && reusableEntries.length > 0) {
    return {
      data: reusableEntries.map((entry) => entry.data),
      fetchedAt: Math.max(...reusableEntries.map((entry) => entry.cachedAt)),
      partial: reusableEntries.length < names.length,
      warning:
        reusableEntries.length < names.length
          ? `SteamDT 接口正在冷却，先展示 ${reusableEntries.length}/${names.length} 种饰品的最近报价。`
          : 'SteamDT 接口正在冷却，已展示最近一次报价。'
    };
  }

  lastPriceRequestAt = now;
  const response = await fetch('https://open.steamdt.com/open/cs2/v1/price/batch', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ marketHashNames: names }),
    signal: AbortSignal.timeout(25_000)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`SteamDT 价格请求失败（${response.status}）`);
  if (!payload?.success) throw new Error(payload?.errorMsg || 'SteamDT 未返回可用价格');

  const fetchedAt = Date.now();
  const priceData = isArray(payload.data) ? payload.data : [];
  priceData.forEach((entry) => {
    const marketHashName = String(entry?.marketHashName || '').trim();
    if (marketHashName) itemPriceCache.set(marketHashName, { cachedAt: fetchedAt, data: entry });
  });
  const result = { data: priceData, fetchedAt };
  priceCache.set(cacheKey, { cachedAt: Date.now(), data: result });
  return result;
};

const fetchSteamDtMarketOverview = async () => {
  const apiKey = String(process.env.STEAMDT_API_KEY || '').trim();
  if (!apiKey) throw new Error('本地服务尚未配置 STEAMDT_API_KEY');
  if (marketCache && Date.now() - marketCache.cachedAt < MARKET_CACHE_MS) return marketCache.data;

  const response = await fetch('https://open.steamdt.com/open/cs2/broad/v1/index', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json'
    },
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`SteamDT 大盘请求失败（${response.status}）`);
  if (!payload?.success) throw new Error(payload?.errorMsg || 'SteamDT 未返回可用大盘数据');

  const result = payload.data || {};
  marketCache = { cachedAt: Date.now(), data: result };
  return result;
};

const cleanSteamNewsText = (value) =>
  String(value || '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\\/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();

const normalizeSteamNews = (payload) => {
  const source = isArray(payload?.appnews?.newsitems) ? payload.appnews.newsitems : [];
  const official = source.filter((item) => String(item?.feedname || '') === 'steam_community_announcements');
  const updates = official.filter((item) => /update|release notes|更新/i.test(String(item?.title || '')));
  const selected = updates.length > 0 ? updates : official;
  return selected.slice(0, 5).map((item) => ({
    id: String(item?.gid || ''),
    title: String(item?.title || 'Counter-Strike 2 官方公告'),
    summary: cleanSteamNewsText(item?.contents).slice(0, 360),
    url: String(item?.url || 'https://steamcommunity.com/app/730/announcements'),
    publishedAt: Number(item?.date) || 0,
    author: String(item?.author || 'Valve')
  }));
};

const fetchSteamOfficialNews = async () => {
  if (newsCache && Date.now() - newsCache.fetchedAt < STEAM_NEWS_CACHE_MS) return newsCache;

  try {
    const params = new URLSearchParams({
      appid: '730',
      count: '12',
      maxlength: '900',
      feeds: 'steam_community_announcements',
      format: 'json'
    });
    const response = await fetch(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'AssetDashboard-CS2-News/1.0'
      },
      signal: AbortSignal.timeout(20_000)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Steam 官方公告请求失败（${response.status}）`);
    const items = normalizeSteamNews(payload);
    if (items.length === 0) throw new Error('Steam 暂未返回 CS2 官方更新日志');

    newsCache = { items, fetchedAt: Date.now(), source: 'Steam' };
    return newsCache;
  } catch (error) {
    if (newsCache?.items) return { ...newsCache, stale: true, warning: error?.message || 'Steam 官方公告暂时不可用' };
    throw error;
  }
};

const handleRequest = async (request, response) => {
  const origin = String(request.headers.origin || '');
  if (origin && !getAllowedOrigins().has(origin)) {
    sendJson(response, 403, { success: false, error: '不允许的请求来源' });
    return;
  }

  if (request.method === 'OPTIONS') {
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }
    response.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600'
    });
    response.end();
    return;
  }

  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);

  try {
    if (request.method === 'GET' && requestUrl.pathname === '/health') {
      sendJson(
        response,
        200,
        {
          success: true,
          service: 'cs2-local-proxy',
          mode: 'local',
          steamDtConfigured: Boolean(String(process.env.STEAMDT_API_KEY || '').trim())
        },
        origin
      );
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/inventory') {
      const steamId = normalizeSteamId(requestUrl.searchParams.get('steamId'));
      if (!steamId) {
        sendJson(response, 400, { success: false, error: '请输入有效的 17 位 SteamID64' }, origin);
        return;
      }
      const data = await fetchSteamInventory(steamId);
      sendJson(response, 200, { success: true, data }, origin);
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/market') {
      const data = await fetchSteamDtMarketOverview();
      sendJson(response, 200, { success: true, data }, origin);
      return;
    }

    if (request.method === 'GET' && requestUrl.pathname === '/news') {
      const data = await fetchSteamOfficialNews();
      sendJson(response, 200, { success: true, data }, origin);
      return;
    }

    if (request.method === 'POST' && requestUrl.pathname === '/prices') {
      const body = await readJsonBody(request);
      if (!isArray(body.marketHashNames)) {
        sendJson(response, 400, { success: false, error: 'marketHashNames 必须是数组' }, origin);
        return;
      }
      const data = await fetchSteamDtPrices(body.marketHashNames);
      sendJson(response, 200, { success: true, data }, origin);
      return;
    }

    sendJson(response, 404, { success: false, error: '接口不存在' }, origin);
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? '上游请求超时，请稍后重试' : error?.message || '请求失败';
    sendJson(response, 502, { success: false, error: message }, origin);
  }
};

export const startCs2Proxy = ({ port = Number(process.env.CS2_PROXY_PORT) || DEFAULT_PORT } = {}) =>
  new Promise((resolveServer, reject) => {
    const server = createServer((request, response) => {
      handleRequest(request, response);
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      console.log(`[CS2] 本地数据服务已启动：http://127.0.0.1:${port}`);
      resolveServer(server);
    });
  });

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  startCs2Proxy().catch((error) => {
    console.error(`[CS2] 本地数据服务启动失败：${error?.message || error}`);
    process.exitCode = 1;
  });
}
