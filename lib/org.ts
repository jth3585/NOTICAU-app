import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// 단과대(colleges)·학과(departments) 코드 → 이름 캐시.
// 두 테이블 모두 소량(수십 행)이라 앱 세션당 1회만 로드해 메모리 캐시로 공유한다.
// (MyPage 등에서 코드별 개별 조회를 반복하던 것 + 진입 시 깜빡임 제거.)

let cache: Map<string, string> | null = null;
let inflight: Promise<Map<string, string>> | null = null;
const listeners = new Set<() => void>();

export async function loadOrgNames(): Promise<Map<string, string>> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const [c, d] = await Promise.all([
      supabase.from('colleges').select('code,name'),
      supabase.from('departments').select('code,name'),
    ]);
    const m = new Map<string, string>();
    ((c.data ?? []) as any[]).forEach((r) => { if (r.code) m.set(r.code, r.name); });
    ((d.data ?? []) as any[]).forEach((r) => { if (r.code) m.set(r.code, r.name); });
    cache = m;
    inflight = null;
    for (const l of listeners) l();
    return m;
  })();
  return inflight;
}

// 코드 → 이름 해석기 훅. 캐시 미로드 시 로드하고, 로드되면 리렌더.
export function useOrgNames(): (code: string | null | undefined) => string {
  const [, force] = useState(0);
  useEffect(() => {
    if (cache) return;
    const cb = () => force((n) => n + 1);
    listeners.add(cb);
    loadOrgNames();
    return () => { listeners.delete(cb); };
  }, []);
  return (code) => (code ? (cache?.get(code) ?? '') : '');
}
