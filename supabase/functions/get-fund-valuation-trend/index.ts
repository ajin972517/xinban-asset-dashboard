import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const rangeDays: Record<string, number | null> = {
  '1m': 31,
  '3m': 93,
  '6m': 186,
  '1y': 366,
  '3y': 1096,
  all: null
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return respond({ success: false, error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return respond({ success: false, error: 'Missing Authorization header' }, 401);

    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) return respond({ success: false, error: 'Unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const fundCode = String(body?.fund_code || '').trim();
    const range = Object.prototype.hasOwnProperty.call(rangeDays, body?.range) ? String(body.range) : '3m';
    if (!/^\d{6}$/.test(fundCode)) return respond({ success: false, error: 'Invalid fund_code' }, 400);

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    let query = serviceClient
      .from('fund_valuation_history')
      .select('trade_date,gztime,source,gszzl,gsz,nav,nav_date')
      .eq('fund_code', fundCode)
      .order('trade_date', { ascending: true })
      .order('source', { ascending: true });

    const days = rangeDays[range];
    if (days !== null) {
      const start = new Date(`${chinaDate()}T00:00:00+08:00`);
      start.setUTCDate(start.getUTCDate() - days);
      query = query.gte('trade_date', start.toISOString().slice(0, 10));
    }

    const { data, error } = await query.limit(5000);
    if (error) throw error;

    const rows = (Array.isArray(data) ? data : []).map((row) => ({
      gztime: row.trade_date,
      source: row.source,
      gszzl: Number(row.gszzl),
      gsz: row.gsz === null ? null : Number(row.gsz),
      nav: row.nav === null ? null : Number(row.nav),
      nav_date: row.nav_date
    }));

    return respond({ success: true, data: rows, range, fund_code: fundCode });
  } catch (error) {
    console.error('get-fund-valuation-trend failed', error);
    return respond({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
