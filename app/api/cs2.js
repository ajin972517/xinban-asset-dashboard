import { isArray, isObject, isString } from 'lodash';

const CLOUD_PROXY_URL = '/api/cs2';
const LOCAL_PROXY_URL = 'http://127.0.0.1:31777';
const REQUEST_TIMEOUT_MS = 30_000;

const getProxyUrl = () => {
  const configured = process.env.NEXT_PUBLIC_CS2_PROXY_URL;
  if (isString(configured) && configured.trim()) return configured.trim().replace(/\/$/, '');
  if (typeof window !== 'undefined' && ['127.0.0.1', 'localhost'].includes(window.location.hostname)) {
    return LOCAL_PROXY_URL;
  }
  return CLOUD_PROXY_URL;
};

const requestJson = async (path, options = {}) => {
  if (typeof fetch === 'undefined') throw new Error('当前环境不支持网络请求');
  const response = await fetch(`${getProxyUrl()}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(isObject(options.headers) ? options.headers : {})
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error || `CS2 数据服务请求失败（${response.status}）`);
  }
  return payload.data ?? payload;
};

export const normalizeSteamId64 = (value) => {
  const input = String(value || '').trim();
  const profileMatch = input.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
  const steamId = profileMatch?.[1] || input;
  return /^\d{17}$/.test(steamId) ? steamId : '';
};

export const checkCs2Service = async () => requestJson('/health');

export const fetchCs2MarketOverview = async () => requestJson('/market');

export const fetchCs2OfficialNews = async () => requestJson('/news');

export const fetchCs2Inventory = async (steamIdInput) => {
  const steamId = normalizeSteamId64(steamIdInput);
  if (!steamId) throw new Error('请输入有效的 17 位 SteamID64');
  return requestJson(`/inventory?steamId=${encodeURIComponent(steamId)}`);
};

export const fetchCs2Prices = async (marketHashNames, steamIdInput) => {
  const steamId = normalizeSteamId64(steamIdInput);
  if (!steamId) throw new Error('价格请求缺少有效的 SteamID64');
  const names = (isArray(marketHashNames) ? marketHashNames : [])
    .map((name) => String(name || '').trim())
    .filter(Boolean);
  if (names.length === 0) return { data: [], fetchedAt: Date.now() };
  return requestJson('/prices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ steamId, marketHashNames: Array.from(new Set(names)) })
  });
};

export const getCs2ProxyUrl = getProxyUrl;
