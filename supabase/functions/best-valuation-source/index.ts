import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const SOURCE_TO_ID: Record<string, number> = {
  fundgz: 1,
  sina_ds2: 2,
  sina_ds3: 3,
  supabase_qdii: 4
};

const SOURCE_PRIORITY = ['fundgz', 'sina_ds2', 'sina_ds3', 'supabase_qdii'];
const MAX_CODES = 100;
const MAX_SAMPLES_PER_SOURCE = 30;

type ValuationRow = {
  fund_code: string;
  trade_date: string;
  source: string;
  gszzl: number | string;
  nav: number | string | null;
  nav_date: string | null;
  collected_at: string;
};

type SourceScore = {
  source: string;
  sourceId: number;
  sampleCount: number;
  weightedMae: number | null;
  latestTradeDate: string | null;
  confidence: 'fallback' | 'low' | 'medium' | 'high';
};

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });

const chinaDate = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

const finiteNumber = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizeEstimate = (row: ValuationRow) => {
  const value = finiteNumber(row.gszzl);
  if (value === null) return null;
  return row.source.startsWith('sina_') ? value * 100 : value;
};

const sourcePriority = (source: string) => {
  const index = SOURCE_PRIORITY.indexOf(source);
  return index < 0 ? SOURCE_PRIORITY.length : index;
};

const getConfidence = (sampleCount: number): SourceScore['confidence'] => {
  if (sampleCount >= 15) return 'high';
  if (sampleCount >= 5) return 'medium';
  if (sampleCount > 0) return 'low';
  return 'fallback';
};

const scoreFundSources = (fundCode: string, rows: ValuationRow[]) => {
  const fundRows = rows.filter((row) => row.fund_code === fundCode && SOURCE_TO_ID[row.source]);
  const navByDate = new Map<string, { nav: number; collectedAt: string }>();

  fundRows.forEach((row) => {
    const nav = finiteNumber(row.nav);
    if (!row.nav_date || nav === null || nav <= 0) return;
    const existing = navByDate.get(row.nav_date);
    if (!existing || row.collected_at > existing.collectedAt) {
      navByDate.set(row.nav_date, { nav, collectedAt: row.collected_at });
    }
  });

  const navPoints = [...navByDate.entries()]
    .map(([date, value]) => ({ date, nav: value.nav }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const actualReturnByDate = new Map<string, number>();
  for (let index = 1; index < navPoints.length; index += 1) {
    const previous = navPoints[index - 1];
    const current = navPoints[index];
    if (previous.nav > 0) actualReturnByDate.set(current.date, (current.nav / previous.nav - 1) * 100);
  }

  const errorsBySource = new Map<string, Array<{ tradeDate: string; error: number }>>();
  const availabilityBySource = new Map<string, { count: number; latestTradeDate: string }>();

  fundRows.forEach((row) => {
    const estimate = normalizeEstimate(row);
    if (estimate === null) return;
    const availability = availabilityBySource.get(row.source);
    availabilityBySource.set(row.source, {
      count: (availability?.count || 0) + 1,
      latestTradeDate:
        !availability?.latestTradeDate || row.trade_date > availability.latestTradeDate
          ? row.trade_date
          : availability.latestTradeDate
    });

    const actualReturn = actualReturnByDate.get(row.trade_date);
    if (actualReturn === undefined) return;
    const samples = errorsBySource.get(row.source) || [];
    samples.push({ tradeDate: row.trade_date, error: Math.abs(estimate - actualReturn) });
    errorsBySource.set(row.source, samples);
  });

  const scoredSources: SourceScore[] = [];
  errorsBySource.forEach((samples, source) => {
    const recent = samples.sort((a, b) => b.tradeDate.localeCompare(a.tradeDate)).slice(0, MAX_SAMPLES_PER_SOURCE);
    let weightedError = 0;
    let totalWeight = 0;
    recent.forEach((sample, index) => {
      const weight = Math.pow(0.94, index);
      weightedError += sample.error * weight;
      totalWeight += weight;
    });
    scoredSources.push({
      source,
      sourceId: SOURCE_TO_ID[source],
      sampleCount: recent.length,
      weightedMae: totalWeight > 0 ? weightedError / totalWeight : null,
      latestTradeDate: availabilityBySource.get(source)?.latestTradeDate || null,
      confidence: getConfidence(recent.length)
    });
  });

  scoredSources.sort((a, b) => {
    const errorDelta = Number(a.weightedMae) - Number(b.weightedMae);
    if (Math.abs(errorDelta) > 0.000001) return errorDelta;
    if (a.sampleCount !== b.sampleCount) return b.sampleCount - a.sampleCount;
    return sourcePriority(a.source) - sourcePriority(b.source);
  });

  if (scoredSources.length > 0) return scoredSources[0];

  const fallback = [...availabilityBySource.entries()].sort((a, b) => {
    if (a[1].count !== b[1].count) return b[1].count - a[1].count;
    if (a[1].latestTradeDate !== b[1].latestTradeDate) {
      return b[1].latestTradeDate.localeCompare(a[1].latestTradeDate);
    }
    return sourcePriority(a[0]) - sourcePriority(b[0]);
  })[0];

  const source = fallback?.[0] || 'fundgz';
  return {
    source,
    sourceId: SOURCE_TO_ID[source] || 1,
    sampleCount: 0,
    weightedMae: null,
    latestTradeDate: fallback?.[1]?.latestTradeDate || null,
    confidence: 'fallback' as const
  };
};

const getExactComparison = (fundCode: string, rows: ValuationRow[], tradeDate: string, actualZzl: number) => {
  const latestBySource = new Map<string, ValuationRow>();
  rows.forEach((row) => {
    if (row.fund_code !== fundCode || row.trade_date !== tradeDate || !SOURCE_TO_ID[row.source]) return;
    const existing = latestBySource.get(row.source);
    if (!existing || row.collected_at > existing.collected_at) latestBySource.set(row.source, row);
  });

  const diffs: Record<string, number> = {};
  latestBySource.forEach((row, source) => {
    const estimate = normalizeEstimate(row);
    if (estimate !== null) diffs[String(SOURCE_TO_ID[source])] = Math.abs(estimate - actualZzl);
  });
  const ranked = Object.entries(diffs).sort((a, b) => a[1] - b[1]);
  if (ranked.length === 0) return null;
  return { bestSource: Number(ranked[0][0]), diff: ranked[0][1], diffs };
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return respond({ success: false, error: 'Method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const requestedCodes = Array.isArray(body?.codes) ? body.codes : [body?.code];
    const codes = [
      ...new Set(requestedCodes.map((code) => String(code || '').trim()).filter((code) => /^\d{6}$/.test(code)))
    ].slice(0, MAX_CODES);
    if (codes.length === 0) return respond({ success: false, error: 'Invalid fund code' }, 400);

    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - 180);
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const allRows: ValuationRow[] = [];
    for (let index = 0; index < codes.length; index += 50) {
      const codeChunk = codes.slice(index, index + 50);
      const { data, error } = await serviceClient
        .from('fund_valuation_history')
        .select('fund_code,trade_date,source,gszzl,nav,nav_date,collected_at')
        .in('fund_code', codeChunk)
        .gte('trade_date', startDate.toISOString().slice(0, 10))
        .order('trade_date', { ascending: true })
        .limit(10000);
      if (error) throw error;
      allRows.push(...((Array.isArray(data) ? data : []) as ValuationRow[]));
    }

    const details: Record<string, SourceScore> = {};
    const sources: Record<string, number> = {};
    codes.forEach((code) => {
      const score = scoreFundSources(code, allRows);
      details[code] = score;
      sources[code] = score.sourceId;
    });

    const singleCode = codes.length === 1 ? codes[0] : null;
    const actualZzl = finiteNumber(body?.actualZzl);
    const tradeDate = String(body?.jzrq || '').trim();
    if (singleCode && /^\d{4}-\d{2}-\d{2}$/.test(tradeDate) && actualZzl !== null) {
      const exact = getExactComparison(singleCode, allRows, tradeDate, actualZzl);
      if (exact) {
        const today = chinaDate();
        return respond({
          success: true,
          data: {
            ...exact,
            source: details[singleCode],
            isTodayAccuracy: tradeDate === today,
            isYesterdayAccuracy: tradeDate < today
          }
        });
      }
    }

    return respond({
      success: true,
      data: {
        sources,
        details,
        ...(singleCode ? { bestSource: sources[singleCode], source: details[singleCode] } : {})
      }
    });
  } catch (error) {
    console.error('best-valuation-source failed', error);
    return respond({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
