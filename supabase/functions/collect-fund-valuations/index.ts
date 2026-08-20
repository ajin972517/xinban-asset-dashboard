import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const COLLECTOR_CRON_SECRET = Deno.env.get('COLLECTOR_CRON_SECRET') || '';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const EASTMONEY_FIELDS = 'FCODE,SHORTNAME,GSZZL,GZTIME,GSZ,NAV,PDATE';
const SUPPORTED_SOURCES = new Set(['fundgz', 'supabase_qdii']);

type HistoryRow = {
  fund_code: string;
  fund_name: string | null;
  trade_date: string;
  gztime: string;
  source: 'fundgz' | 'sina_ds2' | 'sina_ds3' | 'supabase_qdii';
  gszzl: number;
  gsz: number | null;
  nav: number | null;
  nav_date: string | null;
  collected_at: string;
  metadata: Record<string, unknown>;
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const describeError = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return (
      [record.message, record.details, record.hint, record.code].filter(Boolean).join(' | ') || JSON.stringify(record)
    );
  }
  return String(error || 'Unknown error');
};

const chinaDate = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);

const isWeekdayInChina = (dateText: string) => {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short'
  }).format(new Date(`${dateText}T12:00:00+08:00`));
  return weekday !== 'Sat' && weekday !== 'Sun';
};

const asFiniteNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const toChinaTimestamp = (value: unknown) => {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/);
  return match ? `${match[1]}T${match[2]}:00+08:00` : null;
};

const chunk = <T>(items: T[], size: number) => {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
};

const parseSinaJsonp = (text: string) => {
  const start = text.indexOf('callback(');
  const end = text.lastIndexOf(')');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start + 'callback('.length, end));
  } catch {
    return null;
  }
};

const fetchEastmoneyRows = async (codes: string[], today: string) => {
  const rows: HistoryRow[] = [];
  const skipped: Array<{ code: string; reason: string }> = [];

  for (const codeGroup of chunk(codes, 50)) {
    const url =
      `https://fundcomapi.tiantianfunds.com/mm/newCore/FundValuationLast?FCODES=${encodeURIComponent(codeGroup.join(','))}` +
      `&FIELDS=${encodeURIComponent(EASTMONEY_FIELDS)}`;
    const response = await fetch(url, {
      headers: {
        Referer: 'https://fund.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0 fund-dashboard-valuation-collector'
      }
    });
    if (!response.ok) throw new Error(`Eastmoney HTTP ${response.status}`);

    const payload = await response.json();
    const items = Array.isArray(payload?.data) ? payload.data : [];
    const returnedCodes = new Set<string>();

    for (const item of items) {
      const code = String(item?.FCODE || '').trim();
      if (!/^\d{6}$/.test(code)) continue;
      returnedCodes.add(code);
      const gszzl = asFiniteNumber(item?.GSZZL);
      const timestamp = toChinaTimestamp(item?.GZTIME);
      const tradeDate = timestamp?.slice(0, 10) || '';
      if (gszzl === null || !timestamp) {
        skipped.push({ code, reason: 'no_estimate' });
        continue;
      }
      if (tradeDate !== today) {
        skipped.push({ code, reason: `stale_${tradeDate || 'unknown'}` });
        continue;
      }

      rows.push({
        fund_code: code,
        fund_name: item?.SHORTNAME ? String(item.SHORTNAME) : null,
        trade_date: tradeDate,
        gztime: timestamp,
        source: 'fundgz',
        gszzl,
        gsz: asFiniteNumber(item?.GSZ),
        nav: asFiniteNumber(item?.NAV),
        nav_date: /^\d{4}-\d{2}-\d{2}$/.test(String(item?.PDATE || '')) ? String(item.PDATE) : null,
        collected_at: new Date().toISOString(),
        metadata: { provider: 'tiantianfunds', final_snapshot: true }
      });
    }

    for (const code of codeGroup) {
      if (!returnedCodes.has(code)) skipped.push({ code, reason: 'not_returned' });
    }
  }

  return { rows, skipped };
};

const fetchSinaRows = async (codes: string[], today: string) => {
  const results = await Promise.allSettled(
    codes.map(async (code) => {
      const url =
        'https://stock.finance.sina.com.cn/fundInfo/api/openapi.php/' +
        `FdFundService.getEstimateNetworthPic?symbol=${encodeURIComponent(code)}&callback=callback`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 fund-dashboard-valuation-collector' }
      });
      if (!response.ok) return [];
      const payload = parseSinaJsonp(await response.text());
      const data = payload?.result?.data;
      const networth = Array.isArray(data?.networth) ? data.networth : [];
      const last = networth.at(-1);
      if (!last || String(last.pre_date || '') !== today) return [];

      const timestamp = toChinaTimestamp(`${last.pre_date} ${String(last.min_time || '').slice(0, 5)}`);
      if (!timestamp) return [];
      const base = {
        fund_code: code,
        fund_name: null,
        trade_date: today,
        gztime: timestamp,
        nav: asFiniteNumber(data?.worth),
        nav_date: /^\d{8}$/.test(String(data?.worth_date || ''))
          ? String(data.worth_date).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')
          : null,
        collected_at: new Date().toISOString(),
        metadata: { provider: 'sina', final_snapshot: true }
      };
      const output: HistoryRow[] = [];
      const ds2 = asFiniteNumber(last.growthrate);
      const ds3 = asFiniteNumber(last.growthrate2);
      if (ds2 !== null) {
        output.push({ ...base, source: 'sina_ds2', gszzl: ds2, gsz: asFiniteNumber(last.pre_nav) });
      }
      if (ds3 !== null) {
        output.push({ ...base, source: 'sina_ds3', gszzl: ds3, gsz: asFiniteNumber(last.pre_nav2) });
      }
      return output;
    })
  );

  return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
};

const extractCloudSnapshots = (configs: Array<{ data?: Record<string, unknown> | null }>) => {
  const bestByKey = new Map<string, HistoryRow>();
  for (const config of configs) {
    const funds = Array.isArray(config?.data?.funds) ? config.data.funds : [];
    for (const fund of funds) {
      const code = String(fund?.code || '').trim();
      const source = String(fund?.valuationSource || 'fundgz');
      const timestamp = toChinaTimestamp(fund?.gztime);
      const gszzl = asFiniteNumber(fund?.gszzl);
      if (!/^\d{6}$/.test(code) || !timestamp || gszzl === null || !SUPPORTED_SOURCES.has(source)) continue;
      const key = `${code}|${timestamp.slice(0, 10)}|${source}`;
      const row: HistoryRow = {
        fund_code: code,
        fund_name: fund?.name ? String(fund.name) : null,
        trade_date: timestamp.slice(0, 10),
        gztime: timestamp,
        source: source as HistoryRow['source'],
        gszzl,
        gsz: asFiniteNumber(fund?.gsz),
        nav: asFiniteNumber(fund?.dwjz),
        nav_date: /^\d{4}-\d{2}-\d{2}$/.test(String(fund?.jzrq || '')) ? String(fund.jzrq) : null,
        collected_at: new Date().toISOString(),
        metadata: { provider: 'cloud_config_backfill', final_snapshot: false }
      };
      const existing = bestByKey.get(key);
      if (!existing || row.gztime > existing.gztime) bestByKey.set(key, row);
    }
  }
  return [...bestByKey.values()];
};

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  if (!COLLECTOR_CRON_SECRET || req.headers.get('x-cron-secret') !== COLLECTOR_CRON_SECRET) {
    return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const today = chinaDate();
    if (!body?.force && !isWeekdayInChina(today)) {
      return jsonResponse({ success: true, skipped: true, reason: 'non_weekday', trade_date: today });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: configs, error: configError } = await supabase.from('user_configs').select('data');
    if (configError) throw configError;

    const configRows = Array.isArray(configs) ? configs : [];
    const codeSet = new Set<string>();
    for (const config of configRows) {
      const funds = Array.isArray(config?.data?.funds) ? config.data.funds : [];
      for (const fund of funds) {
        const code = String(fund?.code || '').trim();
        if (/^\d{6}$/.test(code)) codeSet.add(code);
      }
    }
    const codes = [...codeSet].sort();
    if (!codes.length) return jsonResponse({ success: true, trade_date: today, fund_count: 0, inserted: 0 });

    const [eastmoney, sinaRows] = await Promise.all([fetchEastmoneyRows(codes, today), fetchSinaRows(codes, today)]);
    const historicalCloudRows = body?.include_cloud_snapshots === false ? [] : extractCloudSnapshots(configRows);
    const rowsByKey = new Map<string, HistoryRow>();
    for (const row of [...historicalCloudRows, ...eastmoney.rows, ...sinaRows]) {
      rowsByKey.set(`${row.fund_code}|${row.trade_date}|${row.source}`, row);
    }
    const allRows = [...rowsByKey.values()];

    if (allRows.length) {
      const { error: upsertError } = await supabase
        .from('fund_valuation_history')
        .upsert(allRows, { onConflict: 'fund_code,trade_date,source' });
      if (upsertError) throw upsertError;
    }

    return jsonResponse({
      success: true,
      trade_date: today,
      fund_count: codes.length,
      inserted_or_updated: allRows.length,
      sources: {
        fundgz: eastmoney.rows.length,
        sina: sinaRows.length,
        cloud_backfill: historicalCloudRows.length
      },
      skipped: eastmoney.skipped
    });
  } catch (error) {
    const message = describeError(error);
    console.error('collect-fund-valuations failed', message);
    return jsonResponse({ success: false, error: message }, 500);
  }
});
