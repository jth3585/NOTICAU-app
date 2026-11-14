import { supabase } from './supabase';
import type { EventInfo, Notice, Profile } from './types';
import { metaOf } from './format';
import { isMismatch } from './matching';

// 행사 탭 데이터. 서버(events_feed RPC)가 '아직 끝나지 않은 행사·참여 이벤트'를 게시판+인스타에서 모아
// 같은 행사 글은 대표 1건으로 묶어 준다. 앱은 내 소속·학년·캠퍼스에 맞는 것만 추려 날짜별로 보여준다.
// (분석 이벤트 로깅은 lib/events.ts — 이름만 비슷하고 무관.)

export type EventNotice = Notice & { event: EventInfo };

export async function fetchEventsFeed(): Promise<EventNotice[]> {
  const { data, error } = await supabase.rpc('events_feed');
  if (error) throw error;
  return ((data ?? []) as EventNotice[]).filter((n) => n && n.event);
}

const NONE: Set<string> = new Set();

// 나에게 해당되는 행사인가.
//  - 학과 한정 여부는 event.open/member_units 로 판정(주최 학과·단과대 구성원만 → 내 소속과 겹쳐야 함).
//  - 학년·캠퍼스·재학상태 등 나머지 타게팅은 공지 피드와 같은 isMismatch 를 쓰되, 학과 조건은 위에서
//    이미 봤으므로 target_depts 를 비워 넘긴다. 행사 탭은 '타 학과 공지 보기' 설정·읽음과 무관하게 보여준다.
export function isEventForMe(n: EventNotice, profile: Profile): boolean {
  if (!n.event.open) {
    const mine = [profile.dept, profile.dept_secondary, profile.college].filter(Boolean) as string[];
    if (!n.event.member_units.some((u) => mine.includes(u))) return false;
  }
  const meta = metaOf(n);
  const metaNoDept = meta ? { ...meta, target_depts: null } : null;
  return !isMismatch(n, metaNoDept, { ...profile, show_cross_dept: true }, NONE, NONE);
}

// 우리 학과·단과대가 주최했거나 우리를 대상으로 한 행사인가('우리 학과' 칩).
export function isMyUnitEvent(n: EventNotice, profile: Profile): boolean {
  const mine = [profile.dept, profile.dept_secondary, profile.college].filter(Boolean) as string[];
  return n.event.member_units.some((u) => mine.includes(u));
}

// ---- KST 날짜 유틸 (행사 일시는 자정이면 '시간 미상'으로 취급) -----------------------

const KST_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const valid = (iso: string | null | undefined): iso is string => !!iso && !isNaN(Date.parse(iso));
const kst = (iso: string) => new Date(Date.parse(iso) + KST_MS);
const dayKey = (iso: string) => kst(iso).toISOString().slice(0, 10);
const todayKey = () => new Date(Date.now() + KST_MS).toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, '0');

function daysFromToday(iso: string): number {
  return Math.round((Date.parse(dayKey(iso) + 'T00:00:00Z') - Date.parse(todayKey() + 'T00:00:00Z')) / 86_400_000);
}
function hasTime(iso: string): boolean {
  const k = kst(iso);
  return !(k.getUTCHours() === 0 && k.getUTCMinutes() === 0);
}
function hm(iso: string): string {
  const k = kst(iso);
  return `${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}`;
}
function md(iso: string): string {
  const k = kst(iso);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()}(${WEEKDAYS[k.getUTCDay()]})`;
}

// 참여 이벤트의 표시용 마감: 공지의 신청 마감 → 없으면 진행 종료일.
export function giveawayDeadline(n: EventNotice): string | null {
  const dl = metaOf(n)?.deadline_at ?? n.event.end_at;
  return valid(dl) ? dl : null;
}

// 카드 왼쪽 날짜 타일.
export type DateTile = { top: string; main: string; sub: string };

export function eventDateTile(n: EventNotice): DateTile {
  if (n.event.kind === 'giveaway') {
    const dl = giveawayDeadline(n);
    if (!dl) return { top: '', main: '상시', sub: '' };
    const k = kst(dl);
    return { top: '마감', main: `${k.getUTCMonth() + 1}/${k.getUTCDate()}`, sub: WEEKDAYS[k.getUTCDay()] };
  }
  const st = n.event.start_at;
  if (!valid(st)) return { top: '일정', main: '미정', sub: '' };
  const k = kst(st);
  return { top: `${k.getUTCMonth() + 1}월`, main: String(k.getUTCDate()), sub: WEEKDAYS[k.getUTCDay()] };
}

// 카드의 시간 줄. 없으면 null(줄 생략).
//  - 하루 안에 끝나는 행사: "18:30 ~ 21:00" (자정을 넘겨도 24시간 이내면 같은 표기)
//  - 여러 날: "12/3(수) ~ 12/4(목)"
//  - 참여 이벤트: "11/20(금) 18:00까지"
export function formatEventWhen(n: EventNotice): string | null {
  if (n.event.kind === 'giveaway') {
    const dl = giveawayDeadline(n);
    if (!dl) return null;
    return hasTime(dl) ? `${md(dl)} ${hm(dl)}까지` : `${md(dl)}까지`;
  }
  const st = n.event.start_at;
  const en = n.event.end_at;
  if (!valid(st)) return null;
  if (valid(en) && Date.parse(en) - Date.parse(st) >= 86_400_000) return `${md(st)} ~ ${md(en)}`;
  if (!hasTime(st)) return null;
  return valid(en) && hasTime(en) ? `${hm(st)} ~ ${hm(en)}` : hm(st);
}

export type EventBadge = { label: string; tone: 'live' | 'urgent' | 'normal' };

export function eventBadge(n: EventNotice): EventBadge | null {
  if (n.event.kind === 'giveaway') {
    const dl = giveawayDeadline(n);
    if (!dl) return null;
    const d = daysFromToday(dl);
    if (d < 0) return null;
    if (d === 0) return { label: '오늘 마감', tone: 'urgent' };
    return { label: `마감 D-${d}`, tone: d <= 3 ? 'urgent' : 'normal' };
  }
  const st = n.event.start_at;
  if (!valid(st)) return null;
  if (Date.parse(st) <= Date.now() && hasStarted(n)) return { label: '진행 중', tone: 'live' };
  const d = daysFromToday(st);
  if (d <= 0) return { label: '오늘', tone: 'urgent' };
  if (d === 1) return { label: '내일', tone: 'urgent' };
  return { label: `D-${d}`, tone: 'normal' };
}

// 시작 시각이 지났는가. 시간 미상(자정)인 날짜는 그날 하루를 '오늘'로 보고 진행 중으로 치지 않는다.
function hasStarted(n: EventNotice): boolean {
  const st = n.event.start_at;
  if (!valid(st)) return false;
  if (!hasTime(st)) return daysFromToday(st) < 0; // 여러 날 행사의 둘째 날 이후
  return Date.parse(st) <= Date.now();
}

// ---- 목록 구성 ---------------------------------------------------------------------

export type EventSection = { title: string; data: EventNotice[] };

const byStart = (a: EventNotice, b: EventNotice) =>
  (a.event.start_at ?? '').localeCompare(b.event.start_at ?? '') || (b.posted_at ?? '').localeCompare(a.posted_at ?? '');

const SOON_MS = 3 * 86_400_000;

// 참여 이벤트 정렬: 마감 가까운 순, 마감 없는 것은 뒤로(최신 게시순).
function sortGiveaways(rows: EventNotice[]): { dated: EventNotice[]; open: EventNotice[] } {
  const dated = rows.filter((n) => giveawayDeadline(n)).sort((a, b) =>
    (giveawayDeadline(a) ?? '').localeCompare(giveawayDeadline(b) ?? ''));
  const open = rows.filter((n) => !giveawayDeadline(n)).sort((a, b) =>
    (b.posted_at ?? '').localeCompare(a.posted_at ?? ''));
  return { dated, open };
}

// 행사 탭 화면 구성.
//  hero: 맨 위 큰 포스터 캐러셀(오늘 + 7일 안에 열리는 참석 행사). 2건 이상일 때만 쓰고,
//        1건뿐이면 캐러셀 대신 아래 그리드의 '이번 주' 섹션으로 내린다(카드 한 장짜리 캐러셀은 어색하다).
//  sections: 2열 포스터 그리드. 다가오는 행사 → 참여 이벤트 → 진행 중 → 일정 미정.
export type EventsLayout = { hero: EventNotice[]; sections: EventSection[] };

const HERO_MIN = 2;

// rows: 이미 '나에게 해당되는 것'으로 추린 목록. giveawaysOnly = '참여 이벤트' 칩.
//  이미 시작한 여러 날짜리 행사 중 곧(3일 안에) 끝나는 것(축제 둘째 날, 공연 기간 등)은 이번 주에 두고,
//  몇 주씩 이어지는 연속 특강·교육은 '진행 중'으로 내려 다가오는 행사가 묻히지 않게 한다.
export function buildEventsLayout(rows: EventNotice[], giveawaysOnly = false): EventsLayout {
  const give = sortGiveaways(rows.filter((n) => n.event.kind === 'giveaway'));
  if (giveawaysOnly) {
    return {
      hero: [],
      sections: [
        { title: '마감이 가까운 순', data: give.dated },
        { title: '상시 참여', data: give.open },
      ].filter((s) => s.data.length > 0),
    };
  }

  const today: EventNotice[] = [];
  const week: EventNotice[] = [];
  const later: EventNotice[] = [];
  const ongoing: EventNotice[] = [];
  const undated: EventNotice[] = [];
  for (const n of rows) {
    if (n.event.kind !== 'event') continue;
    const st = n.event.start_at;
    if (!valid(st)) { undated.push(n); continue; }
    const d = daysFromToday(st);
    if (d === 0) today.push(n);
    else if (d < 0) {
      const ends = n.event.ends_at;
      const endsSoon = !valid(ends) || Date.parse(ends) - Date.now() <= SOON_MS;
      (endsSoon ? today : ongoing).push(n);
    } else if (d <= 7) week.push(n);
    else later.push(n);
  }
  ongoing.sort((a, b) => (a.event.ends_at ?? '').localeCompare(b.event.ends_at ?? ''));
  undated.sort((a, b) => (b.posted_at ?? '').localeCompare(a.posted_at ?? ''));
  const soon = [...today.sort(byStart), ...week.sort(byStart)];
  const useHero = soon.length >= HERO_MIN;

  return {
    hero: useHero ? soon : [],
    sections: [
      { title: '이번 주', data: useHero ? [] : soon },
      { title: '다가오는 행사', data: later.sort(byStart) },
      { title: '참여 이벤트', data: [...give.dated, ...give.open] },
      { title: '진행 중', data: ongoing },
      { title: '일정은 원문에서 확인해요', data: undated },
    ].filter((s) => s.data.length > 0),
  };
}
