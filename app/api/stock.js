import { isArray, isString } from 'lodash';

const STOCK_QUOTE_TIMEOUT_MS = 10000;

const getMarketMeta = (code) => {
  if (code.startsWith('hk')) return { market: 'hk', marketLabel: '港股', currency: 'HKD' };
  if (code.startsWith('us')) return { market: 'us', marketLabel: '美股', currency: 'USD' };
  if (code.startsWith('bj')) return { market: 'cn', marketLabel: '北交所', currency: 'CNY' };
  if (code.startsWith('sh')) return { market: 'cn', marketLabel: '沪市', currency: 'CNY' };
  return { market: 'cn', marketLabel: '深市', currency: 'CNY' };
};

/**
 * 将用户输入转换为腾讯行情代码。
 * 支持：600519、00700、0700.HK、AAPL、AAPL.US，以及已带 sh/sz/bj/hk/us 前缀的代码。
 */
export const normalizeStockCode = (input) => {
  const raw = String(input || '')
    .trim()
    .replace(/\s+/g, '');
  if (!raw) return null;

  const prefixed = raw.match(/^(?:s_)?(sh|sz|bj|hk|us)(.+)$/i);
  if (prefixed) {
    const prefix = prefixed[1].toLowerCase();
    const rest = String(prefixed[2] || '').trim();
    if (!rest) return null;
    if (prefix === 'hk') return /^\d{1,5}$/.test(rest) ? `hk${rest.padStart(5, '0')}` : null;
    if (prefix === 'us') {
      const ticker = rest.replace(/\.(?:US|O|OQ|N)$/i, '').toUpperCase();
      return /^[A-Z][A-Z0-9.-]{0,11}$/.test(ticker) ? `us${ticker}` : null;
    }
    return /^\d{6}$/.test(rest) ? `${prefix}${rest}` : null;
  }

  const hkDot = raw.match(/^(\d{1,5})\.HK$/i);
  if (hkDot) return `hk${hkDot[1].padStart(5, '0')}`;

  if (/^\d{6}$/.test(raw)) {
    if (/^[45689]/.test(raw)) {
      if (/^[48]/.test(raw)) return `bj${raw}`;
      return `sh${raw}`;
    }
    return `sz${raw}`;
  }

  if (/^\d{1,5}$/.test(raw)) return `hk${raw.padStart(5, '0')}`;

  const usTicker = raw.replace(/\.(?:US|O|OQ|N)$/i, '').toUpperCase();
  if (/^[A-Z][A-Z0-9.-]{0,11}$/.test(usTicker)) return `us${usTicker}`;

  return null;
};

export const getStockDisplayCode = (code) => {
  const normalized = normalizeStockCode(code);
  if (!normalized) return String(code || '');
  if (normalized.startsWith('us')) return normalized.slice(2);
  return normalized.slice(2);
};

const parseNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseTencentStockQuote = (code, raw) => {
  if (!isString(raw) || !raw) return null;
  const parts = raw.split('~');
  if (parts.length < 6) return null;

  const price = parseNumber(parts[3]);
  if (price == null || price <= 0) return null;

  const previousClose = parseNumber(parts[4]);
  const parsedChange = parseNumber(parts[31]);
  const parsedChangePercent = parseNumber(parts[32]);
  const change = parsedChange ?? (previousClose != null ? price - previousClose : 0);
  const changePercent =
    parsedChangePercent ??
    (previousClose != null && previousClose !== 0 ? ((price - previousClose) / previousClose) * 100 : 0);
  const marketMeta = getMarketMeta(code);

  return {
    code,
    displayCode: getStockDisplayCode(code),
    name: String(parts[1] || parts[46] || getStockDisplayCode(code)).trim(),
    price,
    previousClose,
    open: parseNumber(parts[5]),
    high: parseNumber(parts[33]),
    low: parseNumber(parts[34]),
    change,
    changePercent,
    volume: parseNumber(parts[6]),
    quoteTime: String(parts[30] || '').trim(),
    quoteUpdatedAt: Date.now(),
    ...marketMeta
  };
};

/** 批量获取 A 股、港股和美股实时快照。 */
export const fetchStockQuotes = async (inputs) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return [];

  const codes = Array.from(
    new Set((isArray(inputs) ? inputs : [inputs]).map((item) => normalizeStockCode(item)).filter(Boolean))
  );
  if (codes.length === 0) return [];

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://qt.gtimg.cn/q=${codes.join(',')}&_t=${Date.now()}`;
    script.charset = 'gbk';
    let done = false;

    const cleanup = () => {
      done = true;
      if (timer) clearTimeout(timer);
      if (document.body.contains(script)) document.body.removeChild(script);
    };

    const timer = setTimeout(() => {
      if (done) return;
      cleanup();
      reject(new Error('股票行情请求超时，请稍后重试'));
    }, STOCK_QUOTE_TIMEOUT_MS);

    script.onload = () => {
      if (done) return;
      const quotes = codes.map((code) => parseTencentStockQuote(code, window[`v_${code}`])).filter(Boolean);
      cleanup();
      resolve(quotes);
    };

    script.onerror = () => {
      if (done) return;
      cleanup();
      reject(new Error('股票行情加载失败，请检查网络后重试'));
    };

    document.body.appendChild(script);
  });
};

const fetchTencentChartPayload = async (url, variableName) => {
  if (typeof fetch === 'undefined') return null;
  const response = await fetch(url);
  if (!response.ok) throw new Error('股票图表数据加载失败');
  const text = await response.text();
  const prefix = `${variableName}=`;
  const jsonText = text.startsWith(prefix) ? text.slice(prefix.length).replace(/;\s*$/, '') : text;
  return JSON.parse(jsonText);
};

/** 获取当日分时价格。 */
export const fetchStockMinute = async (input) => {
  const code = normalizeStockCode(input);
  if (!code) return [];
  const variableName = `stock_minute_${code}_${Date.now()}`;
  const url =
    `https://web.ifzq.gtimg.cn/appstock/app/minute/query?_var=${variableName}` +
    `&code=${encodeURIComponent(code)}&_=${Date.now()}`;
  const payload = await fetchTencentChartPayload(url, variableName);
  const rows = payload?.data?.[code]?.data?.data;
  if (!isArray(rows)) return [];
  return rows
    .map((row) => {
      const [time, price, volume, amount] = String(row || '')
        .trim()
        .split(/\s+/);
      const parsedPrice = parseNumber(price);
      if (!time || parsedPrice == null) return null;
      return {
        time,
        label: `${time.slice(0, 2)}:${time.slice(2)}`,
        price: parsedPrice,
        volume: parseNumber(volume) || 0,
        amount: parseNumber(amount) || 0
      };
    })
    .filter(Boolean);
};

/** 获取前复权日 K 数据。 */
export const fetchStockKline = async (input, count = 120) => {
  const code = normalizeStockCode(input);
  if (!code) return [];
  const safeCount = Math.min(300, Math.max(10, Number(count) || 120));
  const variableName = `stock_kline_${code}_${Date.now()}`;
  const url =
    `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?_var=${variableName}` +
    `&param=${encodeURIComponent(`${code},day,,,${safeCount},qfq`)}&_=${Date.now()}`;
  const payload = await fetchTencentChartPayload(url, variableName);
  const bucket = payload?.data?.[code];
  const rows = bucket?.qfqday || bucket?.day;
  if (!isArray(rows)) return [];
  return rows
    .map((row) => {
      if (!isArray(row) || row.length < 6) return null;
      const open = parseNumber(row[1]);
      const close = parseNumber(row[2]);
      const high = parseNumber(row[3]);
      const low = parseNumber(row[4]);
      if ([open, close, high, low].some((value) => value == null)) return null;
      return {
        date: String(row[0] || ''),
        open,
        close,
        high,
        low,
        volume: parseNumber(row[5]) || 0
      };
    })
    .filter(Boolean);
};
