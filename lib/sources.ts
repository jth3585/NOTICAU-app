import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// 출처(parser_key) → 표시 이름 맵. DB sources.name이 단일 소스.
// 대표 출처 배지는 공지에 조인돼 오는 sources.name을 직접 쓰지만, 교차출처 중복
// (dup_source_keys: parser_key 배열)처럼 이름이 같이 안 실려오는 곳을 위해 전역 캐시로 제공.
// → DB에 출처를 추가하고 name만 채우면 앱 재빌드 없이 표시 이름이 반영된다.

let cache: Record<string, string> | null = null;
const listeners = new Set<(m: Record<string, string>) => void>();

export async function loadSourceLabels(): Promise<Record<string, string>> {
  const { data } = await supabase.from('sources').select('parser_key, name');
  const map: Record<string, string> = {};
  (data ?? []).forEach((s: any) => {
    if (s.parser_key) map[s.parser_key] = s.name ?? s.parser_key;
  });
  cache = map;
  for (const l of listeners) l(map);
  return map;
}

// parser_key 라벨 함수를 반환하는 훅. 이름 미확인 시 키 원문으로 폴백.
export function useSourceLabels() {
  const [map, setMap] = useState<Record<string, string>>(cache ?? {});
  useEffect(() => {
    listeners.add(setMap);
    if (cache) setMap(cache);
    else loadSourceLabels();
    return () => { listeners.delete(setMap); };
  }, []);
  return (key: string | null | undefined): string => (key ? (map[key] ?? key) : '');
}
