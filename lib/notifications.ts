import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { NOTICE_CARD_SELECT } from './notices';
import type { Notice } from './types';

// 알림함(홈 우상단 🔔). 서버(keyword_alert_push / daily_digest_push / event_extract 의 행사 알림)가
// notifications 테이블에 기록 → 앱은 조회 + 읽음 처리만 한다(RLS: 본인 것만, read_at만 수정 가능).
// 보관 14일(서버 cron 정리).

export type NotificationType = 'keyword' | 'digest' | 'event' | string;

// 행사 알림('내 학과 새 행사') 수신 여부. 서버는 profiles.event_alerts_enabled 가 true 인 사람에게만 보낸다.
// 값이 없으면(null) 이 기능이 생기기 전 버전을 쓰던 사람이므로, 새 앱의 첫 실행에서 한 번 켜 준다.
// 사용자가 직접 끈 값(false)은 건드리지 않는다.
export async function enableEventAlertsByDefault(userId: string): Promise<void> {
  await supabase
    .from('profiles')
    .update({ event_alerts_enabled: true })
    .eq('user_id', userId)
    .is('event_alerts_enabled', null);
}

export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  notice_ids: string[];
  data: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
};

const SELECT = 'id, type, title, body, notice_ids, data, created_at, read_at';

export async function fetchNotifications(limit = 100): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select(SELECT)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as AppNotification[];
}

export async function fetchNotification(id: string): Promise<AppNotification | null> {
  const { data } = await supabase.from('notifications').select(SELECT).eq('id', id).maybeSingle();
  return (data as AppNotification) ?? null;
}

export async function markNotificationRead(id: string): Promise<void> {
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null);
}

export async function markAllNotificationsRead(): Promise<void> {
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
}

export async function hasUnreadNotifications(): Promise<boolean> {
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  return (count ?? 0) > 0;
}

// 알림에 묶인 공지들을 카드용으로 조회. 알림에 담긴 순서를 유지하고, 그사이 삭제·숨김된 공지는 빠진다.
// 인스타 공지는 notices 직접 조회가 막혀 있어(RLS: 게시판 글만) 빠진 id 만 notice_by_id RPC 로 보충한다.
export async function fetchNoticesByIds(ids: string[]): Promise<Notice[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.from('notices').select(NOTICE_CARD_SELECT).in('id', ids);
  const byId = new Map(((data ?? []) as unknown as Notice[]).map((n) => [n.id, n]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    const extra = await Promise.all(
      missing.slice(0, 30).map(async (id) => (await supabase.rpc('notice_by_id', { p_id: id })).data as Notice | null),
    );
    for (const n of extra) if (n?.id) byId.set(n.id, n);
  }
  return ids.map((id) => byId.get(id)).filter((n): n is Notice => !!n);
}

// 홈 🔔 빨간 점용. 화면 포커스마다 refresh() 호출.
export function useUnreadNotifications() {
  const [hasUnread, setHasUnread] = useState(false);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    const v = await hasUnreadNotifications();
    if (mounted.current) setHasUnread(v);
  }, []);
  useEffect(() => {
    mounted.current = true;
    refresh();
    return () => { mounted.current = false; };
  }, [refresh]);
  return { hasUnread, refresh };
}

// 알림 시각 표시: 방금 전 / N분 전 / N시간 전 / 어제 / M월 D일
export function formatNotifTime(iso: string, now = new Date()): string {
  const t = new Date(iso);
  const diffMin = Math.floor((now.getTime() - t.getTime()) / 60000);
  if (diffMin < 1) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  const sameDay = kstDayKey(t) === kstDayKey(now);
  if (sameDay) return `${Math.floor(diffMin / 60)}시간 전`;
  const yesterday = new Date(now.getTime() - 86400000);
  if (kstDayKey(t) === kstDayKey(yesterday)) return '어제';
  const k = new Date(t.getTime() + 9 * 3600000);
  return `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일`;
}

// KST 기준 날짜 키(YYYY-MM-DD)
export function kstDayKey(d: Date): string {
  return new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}

// 알림함 그룹: 오늘 / 어제 / 이번 주(7일 이내) / 이전
export function notifGroupLabel(iso: string, now = new Date()): string {
  const t = new Date(iso);
  if (kstDayKey(t) === kstDayKey(now)) return '오늘';
  if (kstDayKey(t) === kstDayKey(new Date(now.getTime() - 86400000))) return '어제';
  if (now.getTime() - t.getTime() < 7 * 86400000) return '이번 주';
  return '이전 알림';
}
