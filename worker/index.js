import lodash from 'lodash';

const { isArray } = lodash;

const INVENTORY_CACHE_SECONDS = 10 * 60;
const INVENTORY_ATTEMPT_TTL_SECONDS = 3 * 24 * 60 * 60;
const PRICE_CACHE_SECONDS = 60;
const PRICE_FALLBACK_CACHE_SECONDS = 10 * 60;
const STEAM_NEWS_CACHE_SECONDS = 30 * 60;
const MAX_INVENTORY_PAGES = 20;
const MAX_PRICE_ITEMS = 250;
const MAX_REQUEST_BODY_BYTES = 1_000_000;

const jsonResponse = (payload, status = 200) =>
  Response.json(payload, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff'
    }
  });

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

const assertAllowedSteamId = (steamId, env) => {
  const allowedSteamId = normalizeSteamId(env.CS2_ALLOWED_STEAM_ID);
  if (!allowedSteamId) throw new Error('云端服务尚未配置允许访问的 SteamID64');
  if (steamId !== allowedSteamId) throw new Error('此云端服务仅允许同步已配置的 SteamID64');
};

const getDescriptionKey = (classId, instanceId) => `${classId || ''}_${instanceId || '0'}`;

const getCacheRequest = (key) => new Request(`https://cs2-cache.internal/${key}`);

const getCachedJson = async (key) => {
  const response = await caches.default.match(getCacheRequest(key));
  return response ? response.json().catch(() => null) : null;
};

const putCachedJson = (key, value, seconds) =>
  caches.default.put(
    getCacheRequest(key),
    Response.json(value, {
      headers: { 'Cache-Control': `public, max-age=${seconds}` }
    })
  );

const fetchSteamInventoryPage = async (steamId, startAssetId = '') => {
  const params = new URLSearchParams({ l: 'schinese', count: '2000' });
  if (startAssetId) params.set('start_assetid', startAssetId);
  const response = await fetch(`https://steamcommunity.com/inventory/${steamId}/730/2?${params.toString()}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'AssetDashboard-CS2-Cloud/1.0'
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

const fetchSteamInventory = async (steamId, env, ctx) => {
  const today = chinaDate();
  const cacheKey = `inventory-daily-v2/${steamId}/${today}`;
  const cached = await getCachedJson(cacheKey);
  if (cached) return cached;

  const persistentKey = `inventory:${steamId}`;
  const attemptKey = `inventory-attempt:${steamId}:${today}`;
  const [persistent, attemptedToday] = await Promise.all([
    env.CS2_CACHE.get(persistentKey, 'json'),
    env.CS2_CACHE.get(attemptKey, 'json')
  ]);

  if (persistent && isArray(persistent.items) && chinaDate(Number(persistent.fetchedAt) || 0) === today) {
    const dailyResult = withDailyRefreshState(persistent, today);
    ctx.waitUntil(putCachedJson(cacheKey, dailyResult, INVENTORY_CACHE_SECONDS));
    return dailyResult;
  }

  if (attemptedToday) {
    if (!persistent || !isArray(persistent.items)) {
      throw new Error('Steam 今日库存刷新已经尝试过，请明日再试');
    }
    const retryResult = withDailyRefreshState(persistent, today, {
      stale: true,
      staleReason: attemptedToday.error || 'Steam 今日库存刷新未成功',
      warning: `Steam 今日库存刷新已尝试但未成功（${attemptedToday.error || '访问受限'}），已使用 ${new Date(
        Number(persistent.fetchedAt) || Date.now()
      ).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })} 的云端缓存；明日自动开放下一次刷新。`
    });
    ctx.waitUntil(putCachedJson(cacheKey, retryResult, INVENTORY_CACHE_SECONDS));
    return retryResult;
  }

  await env.CS2_CACHE.put(attemptKey, JSON.stringify({ attemptedAt: Date.now() }), {
    expirationTtl: INVENTORY_ATTEMPT_TTL_SECONDS
  });

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
    ctx.waitUntil(
      Promise.all([
        putCachedJson(cacheKey, result, INVENTORY_CACHE_SECONDS),
        env.CS2_CACHE.put(persistentKey, JSON.stringify(result))
      ])
    );
    return result;
  } catch (error) {
    if (!persistent || !isArray(persistent.items)) throw error;
    const errorMessage = error?.message || 'Steam 访问受限';
    const staleResult = withDailyRefreshState(persistent, today, {
      stale: true,
      staleReason: errorMessage,
      warning: `Steam 今日库存刷新未成功（${errorMessage}），已使用 ${new Date(
        Number(persistent.fetchedAt) || Date.now()
      ).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false
      })} 的云端缓存；为避免继续限流，明日再尝试。`
    });
    ctx.waitUntil(
      Promise.all([
        putCachedJson(cacheKey, staleResult, INVENTORY_CACHE_SECONDS),
        env.CS2_CACHE.put(attemptKey, JSON.stringify({ attemptedAt: Date.now(), error: errorMessage }), {
          expirationTtl: INVENTORY_ATTEMPT_TTL_SECONDS
        })
      ])
    );
    return staleResult;
  }
};

const getPriceCacheKey = async (names) => {
  const bytes = new TextEncoder().encode(names.slice().sort().join('\u001f'));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const filterPriceData = (data, names) => {
  const requested = new Set(names);
  return (isArray(data) ? data : []).filter((entry) => requested.has(String(entry?.marketHashName || '')));
};

const fetchSteamDtPrices = async (marketHashNames, env, ctx) => {
  const apiKey = String(env.STEAMDT_API_KEY || '').trim();
  if (!apiKey) throw new Error('云端服务尚未配置 SteamDT API Key');

  const names = Array.from(
    new Set(
      marketHashNames
        .map((name) => String(name || '').trim())
        .filter(Boolean)
        .slice(0, MAX_PRICE_ITEMS)
    )
  );
  if (names.length === 0) return { data: [], fetchedAt: Date.now() };

  const hash = await getPriceCacheKey(names);
  const exactCacheKey = `prices/${hash}`;
  const exactCached = await getCachedJson(exactCacheKey);
  if (exactCached) return exactCached;

  const exactPersistentKey = `prices:${hash}`;
  const exactPersistent = await env.CS2_CACHE.get(exactPersistentKey, 'json');
  if (exactPersistent && Date.now() - Number(exactPersistent.fetchedAt) < PRICE_CACHE_SECONDS * 1000) {
    return exactPersistent;
  }

  const latestCacheKey = 'prices/latest';
  const cooldownCacheKey = 'prices/cooldown';
  const [edgeLatest, edgeCoolingDown, persistentLatest, persistentCoolingDown] = await Promise.all([
    getCachedJson(latestCacheKey),
    getCachedJson(cooldownCacheKey),
    env.CS2_CACHE.get('prices:latest', 'json'),
    env.CS2_CACHE.get('prices:cooldown', 'json')
  ]);
  const latest = edgeLatest || persistentLatest;
  const coolingDown = edgeCoolingDown || persistentCoolingDown;
  if (coolingDown && latest) {
    const reusable = filterPriceData(latest.data, names);
    return {
      data: reusable,
      fetchedAt: Number(latest.fetchedAt) || Date.now(),
      partial: reusable.length < names.length,
      warning:
        reusable.length < names.length
          ? `SteamDT 接口正在冷却，先展示 ${reusable.length}/${names.length} 种饰品的最近报价。`
          : 'SteamDT 接口正在冷却，已展示最近一次报价。'
    };
  }

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

  const result = { data: isArray(payload.data) ? payload.data : [], fetchedAt: Date.now() };
  ctx.waitUntil(
    Promise.all([
      putCachedJson(exactCacheKey, result, PRICE_CACHE_SECONDS),
      putCachedJson(latestCacheKey, result, PRICE_FALLBACK_CACHE_SECONDS),
      putCachedJson(cooldownCacheKey, { active: true }, PRICE_CACHE_SECONDS),
      env.CS2_CACHE.put(exactPersistentKey, JSON.stringify(result), { expirationTtl: PRICE_FALLBACK_CACHE_SECONDS }),
      env.CS2_CACHE.put('prices:latest', JSON.stringify(result), { expirationTtl: PRICE_FALLBACK_CACHE_SECONDS }),
      env.CS2_CACHE.put('prices:cooldown', JSON.stringify({ active: true }), {
        expirationTtl: PRICE_CACHE_SECONDS
      })
    ])
  );
  return result;
};

const fetchSteamDtMarketOverview = async (env, ctx) => {
  const apiKey = String(env.STEAMDT_API_KEY || '').trim();
  if (!apiKey) throw new Error('云端服务尚未配置 SteamDT API Key');

  const cacheKey = 'market/overview';
  const persistentKey = 'market:overview';
  const [edgeCached, persistentCached] = await Promise.all([
    getCachedJson(cacheKey),
    env.CS2_CACHE.get(persistentKey, 'json')
  ]);
  const cached = edgeCached || persistentCached;
  if (cached && Date.now() - Number(cached.fetchedAt) < 5 * 60_000) return cached.data;

  try {
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

    const result = { data: payload.data || {}, fetchedAt: Date.now() };
    ctx.waitUntil(
      Promise.all([
        putCachedJson(cacheKey, result, 300),
        env.CS2_CACHE.put(persistentKey, JSON.stringify(result), { expirationTtl: 24 * 60 * 60 })
      ])
    );
    return result.data;
  } catch (error) {
    if (cached?.data) return { ...cached.data, stale: true, warning: error?.message || '大盘行情暂时不可用' };
    throw error;
  }
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

const fetchSteamOfficialNews = async (env, ctx) => {
  const cacheKey = 'news/official';
  const persistentKey = 'news:official';
  const [edgeCached, persistentCached] = await Promise.all([
    getCachedJson(cacheKey),
    env.CS2_CACHE.get(persistentKey, 'json')
  ]);
  const cached = edgeCached || persistentCached;
  if (cached && Date.now() - Number(cached.fetchedAt) < STEAM_NEWS_CACHE_SECONDS * 1000) return cached;

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

    const result = { items, fetchedAt: Date.now(), source: 'Steam' };
    ctx.waitUntil(
      Promise.all([
        putCachedJson(cacheKey, result, STEAM_NEWS_CACHE_SECONDS),
        env.CS2_CACHE.put(persistentKey, JSON.stringify(result), { expirationTtl: 7 * 24 * 60 * 60 })
      ])
    );
    return result;
  } catch (error) {
    if (cached?.items) return { ...cached, stale: true, warning: error?.message || 'Steam 官方公告暂时不可用' };
    throw error;
  }
};

const readJsonBody = async (request) => {
  const contentLength = Number(request.headers.get('Content-Length')) || 0;
  if (contentLength > MAX_REQUEST_BODY_BYTES) throw new Error('请求内容过大');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BODY_BYTES) throw new Error('请求内容过大');
  return text ? JSON.parse(text) : {};
};

const handleCs2Request = async (request, env, ctx) => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/cs2/, '') || '/';

  if (request.method === 'GET' && path === '/health') {
    return jsonResponse({
      success: true,
      service: 'cs2-cloud-service',
      mode: 'cloud',
      steamDtConfigured: Boolean(String(env.STEAMDT_API_KEY || '').trim()),
      steamIdRestricted: Boolean(normalizeSteamId(env.CS2_ALLOWED_STEAM_ID))
    });
  }

  if (request.method === 'GET' && path === '/inventory') {
    const steamId = normalizeSteamId(url.searchParams.get('steamId'));
    if (!steamId) return jsonResponse({ success: false, error: '请输入有效的 17 位 SteamID64' }, 400);
    assertAllowedSteamId(steamId, env);
    const data = await fetchSteamInventory(steamId, env, ctx);
    return jsonResponse({ success: true, data });
  }

  if (request.method === 'GET' && path === '/market') {
    const data = await fetchSteamDtMarketOverview(env, ctx);
    return jsonResponse({ success: true, data });
  }

  if (request.method === 'GET' && path === '/news') {
    const data = await fetchSteamOfficialNews(env, ctx);
    return jsonResponse({ success: true, data });
  }

  if (request.method === 'POST' && path === '/prices') {
    const body = await readJsonBody(request);
    const steamId = normalizeSteamId(body.steamId);
    if (!steamId) return jsonResponse({ success: false, error: '价格请求缺少有效的 SteamID64' }, 400);
    assertAllowedSteamId(steamId, env);
    if (!isArray(body.marketHashNames)) {
      return jsonResponse({ success: false, error: 'marketHashNames 必须是数组' }, 400);
    }
    const data = await fetchSteamDtPrices(body.marketHashNames, env, ctx);
    return jsonResponse({ success: true, data });
  }

  return jsonResponse({ success: false, error: '接口不存在' }, 404);
};

const worker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/cs2/')) return env.ASSETS.fetch(request);

    try {
      return await handleCs2Request(request, env, ctx);
    } catch (error) {
      const message = error?.name === 'TimeoutError' ? '上游请求超时，请稍后重试' : error?.message || '请求失败';
      const status = /仅允许|尚未配置/.test(message) ? 403 : 502;
      return jsonResponse({ success: false, error: message }, status);
    }
  }
};

export default worker;
