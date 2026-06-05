import { supabase } from './supabase';

export async function ensureAnonSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return session;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.error('[auth] anon signin failed', error.message);
    return null;
  }
  return data.session;
}
