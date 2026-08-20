import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseProxyPath = process.env.NEXT_PUBLIC_SUPABASE_PROXY_PATH || '';
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const getSupabaseClientUrl = () => {
  if (supabaseProxyPath && typeof window !== 'undefined') {
    return new URL(supabaseProxyPath, `${window.location.origin}/`).toString().replace(/\/$/, '');
  }
  return supabaseUrl;
};

const createNoopChannel = () => {
  const channel = {
    on: () => channel,
    subscribe: () => channel
  };
  return channel;
};

const createNoopTable = () => {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: null, error: { message: 'Supabase not configured' } })
      })
    }),
    insert: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
    upsert: () => ({
      select: async () => ({ data: null, error: { message: 'Supabase not configured' } })
    })
  };
};

const createNoopSupabase = () => ({
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({
      data: { subscription: { unsubscribe: () => {} } }
    }),
    signInWithOtp: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
    signInWithOAuth: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
    verifyOtp: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
    signOut: async () => ({ error: null })
  },
  from: () => createNoopTable(),
  channel: () => createNoopChannel(),
  removeChannel: () => {},
  rpc: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
  functions: {
    invoke: async () => ({ data: null, error: { message: 'Supabase not configured' } })
  }
});

export const supabase = isSupabaseConfigured
  ? createClient(getSupabaseClientUrl(), supabaseAnonKey, {
      auth: {
        // 启用自动刷新 token
        autoRefreshToken: true,
        // 持久化 session 到 localStorage
        persistSession: true,
        // 检测 URL 中的 session（用于邮箱验证回调）
        detectSessionInUrl: true
      }
    })
  : createNoopSupabase();
