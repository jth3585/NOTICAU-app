import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

export type Folder = {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
  created_at: string;
};

export const FOLDER_NAME_MAX = 20;

export type FolderResult = { ok: true; folder?: Folder } | { ok: false; error: 'duplicate' | 'empty' | 'unknown' };

// 이름 정규화 + 빈값 체크. 중복 판정은 DB unique(user_id,name)에 위임.
function normalizeName(name: string): string {
  return name.trim();
}

// 폴더 생성. sort_order = 기존 최대 + 1. 중복 이름은 23505 → 'duplicate'.
export async function createFolder(name: string): Promise<FolderResult> {
  const clean = normalizeName(name);
  if (!clean) return { ok: false, error: 'empty' };
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ok: false, error: 'unknown' };

  const { data: maxRow } = await supabase
    .from('bookmark_folders')
    .select('sort_order')
    .eq('user_id', session.user.id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (maxRow?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from('bookmark_folders')
    .insert({ user_id: session.user.id, name: clean, sort_order: nextOrder })
    .select()
    .single();
  if (error) return { ok: false, error: error.code === '23505' ? 'duplicate' : 'unknown' };
  return { ok: true, folder: data as Folder };
}

export async function renameFolder(id: string, name: string): Promise<FolderResult> {
  const clean = normalizeName(name);
  if (!clean) return { ok: false, error: 'empty' };
  const { error } = await supabase
    .from('bookmark_folders')
    .update({ name: clean })
    .eq('id', id);
  if (error) return { ok: false, error: error.code === '23505' ? 'duplicate' : 'unknown' };
  return { ok: true };
}

// 폴더만 삭제. 소속 북마크는 FK(ON DELETE SET NULL)로 미분류 복귀 (북마크 자체는 유지).
export async function deleteFolder(id: string): Promise<void> {
  await supabase.from('bookmark_folders').delete().eq('id', id);
}

// 북마크를 폴더에 지정/해제. folderId=null → 미분류.
export async function setBookmarkFolder(noticeId: string, folderId: string | null): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  await supabase
    .from('user_feed_state')
    .update({ bookmark_folder_id: folderId })
    .eq('user_id', session.user.id)
    .eq('notice_id', noticeId);
}

// 사용자 폴더 목록 + 폴더별 북마크 수.
export function useFolders() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  // ref 로 둔다: state 면 첫 로드가 끝나며 refresh 가 새로 만들어져 마운트·포커스 효과가 한 번 더 돈다.
  const loadedOnce = useRef(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      loadedOnce.current = true;
      if (mountedRef.current) { setFolders([]); setCounts(new Map()); setLoading(false); }
      return;
    }
    const [foldersRes, rowsRes] = await Promise.all([
      supabase.from('bookmark_folders').select('*').eq('user_id', session.user.id).order('sort_order', { ascending: true }),
      supabase.from('user_feed_state').select('bookmark_folder_id')
        .eq('user_id', session.user.id)
        .not('bookmarked_at', 'is', null)
        .not('bookmark_folder_id', 'is', null),
    ]);
    const countMap = new Map<string, number>();
    ((rowsRes.data ?? []) as { bookmark_folder_id: string | null }[]).forEach((r) => {
      if (r.bookmark_folder_id) countMap.set(r.bookmark_folder_id, (countMap.get(r.bookmark_folder_id) ?? 0) + 1);
    });
    loadedOnce.current = true;
    if (mountedRef.current) {
      // 조회 실패 시엔 보이던 폴더를 지우지 않는다.
      if (!foldersRes.error) setFolders((foldersRes.data as Folder[]) ?? []);
      if (!rowsRes.error) setCounts(countMap);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => { mountedRef.current = false; };
  }, [refresh]);

  return { folders, counts, loading, refresh };
}
