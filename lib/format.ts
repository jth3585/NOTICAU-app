import type { Notice, NoticeMeta, Source } from './types';

// PostgREST 임베드가 객체/배열 어느 쪽으로 와도 단일 값으로 정규화.
export function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export const metaOf = (n: Notice): NoticeMeta | null => one(n.notice_meta);
export const sourceOf = (n: Notice): Source | null => one(n.sources);

// ---- KST(Asia/Seoul, UTC+9) 날짜 유틸 ------------------------------------

// ISO → KST 기준 Date 컴포넌트로 보정 (getUTC* 로 읽으면 KST 값)
function toKst(iso: string): Date {
  return new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
}

function kstDateKey(iso: string): string {
  return toKst(iso).toISOString().slice(0, 10); // YYYY-MM-DD
}

function kstTodayKey(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 두 날짜키(YYYY-MM-DD) 차이 (a - b, 일 단위)
function dayDiff(aKey: string, bKey: string): number {
  const a = Date.parse(aKey + 'T00:00:00Z');
  const b = Date.parse(bKey + 'T00:00:00Z');
  return Math.round((a - b) / 86_400_000);
}

// posted_at이 오늘(KST)인지
export function isPostedToday(postedAt: string | null): boolean {
  if (!postedAt) return false;
  return kstDateKey(postedAt) === kstTodayKey();
}

export type Dday = {
  label: string; // 'D-day' | 'D-N' | '마감'
  overdue: boolean;
  urgent: boolean; // D-3 이하 (오늘 포함)
};

// 카드용 D-day. deadline 없으면 null.
export function formatDday(deadlineAt: string | null): Dday | null {
  if (!deadlineAt) return null;
  if (isNaN(Date.parse(deadlineAt))) return null;
  const diff = dayDiff(kstDateKey(deadlineAt), kstTodayKey());
  if (diff < 0) return { label: '마감', overdue: true, urgent: false };
  if (diff === 0) return { label: 'D-day', overdue: false, urgent: true };
  return { label: `D-${diff}`, overdue: false, urgent: diff <= 3 };
}

// KST 기준 마감일까지 남은 일수 (오늘=0, 내일=1, 지남=음수). 없으면 null.
export function ddayDiff(deadlineAt: string | null): number | null {
  if (!deadlineAt || isNaN(Date.parse(deadlineAt))) return null;
  return dayDiff(kstDateKey(deadlineAt), kstTodayKey());
}

// posted_at → "M/D" (KST)
export function formatDateShort(iso: string | null): string {
  if (!iso || isNaN(Date.parse(iso))) return '';
  const k = toKst(iso);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()}`;
}

// 상세용 작성일 → "YYYY.MM.DD" (KST)
export function formatDateFull(iso: string | null): string {
  if (!iso || isNaN(Date.parse(iso))) return '';
  const k = toKst(iso);
  const mo = String(k.getUTCMonth() + 1).padStart(2, '0');
  const da = String(k.getUTCDate()).padStart(2, '0');
  return `${k.getUTCFullYear()}.${mo}.${da}`;
}

export type DeadlineDetail = {
  dday: Dday;
  abs: string; // "YYYY-MM-DD" 또는 "YYYY-MM-DD HH:mm"
  time: string | null; // "HH:mm" (시간 정보 있을 때만)
};

// 상세화면용. 시간 정보(00:00 아님)가 있으면 시간까지 노출.
export function formatDeadlineDetail(deadlineAt: string | null): DeadlineDetail | null {
  const dday = formatDday(deadlineAt);
  if (!dday || !deadlineAt) return null;
  const k = toKst(deadlineAt);
  const y = k.getUTCFullYear();
  const mo = String(k.getUTCMonth() + 1).padStart(2, '0');
  const da = String(k.getUTCDate()).padStart(2, '0');
  const hh = String(k.getUTCHours()).padStart(2, '0');
  const mi = String(k.getUTCMinutes()).padStart(2, '0');
  const hasTime = !(hh === '00' && mi === '00'); // 자정이면 시간 정보 없는 것으로 간주
  return {
    dday,
    abs: `${y}-${mo}-${da}` + (hasTime ? ` ${hh}:${mi}` : ''),
    time: hasTime ? `${hh}:${mi}` : null,
  };
}

export type SortMode = 'deadline' | 'posted';

// 정렬. 'deadline': 임박 마감(오늘·미래) 오름차순(가까운 게 위) → 마감 지난 것 → 마감 없는 것.
//        같은 그룹 내 동률은 posted_at(desc). 마감 지난 공지는 최상단을 차지하지 않고 아래로.
//      'posted': posted_at(desc)만. 둘 다 안정 정렬.
export function sortNotices(rows: Notice[], mode: SortMode = 'deadline'): Notice[] {
  if (mode === 'posted') {
    return [...rows].sort((a, b) => (b.posted_at ?? '').localeCompare(a.posted_at ?? ''));
  }
  const today = kstTodayKey();
  // 0: 임박(오늘·미래 마감), 1: 마감 지남, 2: 마감 없음
  const rank = (n: Notice): number => {
    const dl = metaOf(n)?.deadline_at ?? null;
    if (!dl || isNaN(Date.parse(dl))) return 2;
    return dayDiff(kstDateKey(dl), today) >= 0 ? 0 : 1;
  };
  return [...rows].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    const da = metaOf(a)?.deadline_at ?? '';
    const db = metaOf(b)?.deadline_at ?? '';
    const pa = a.posted_at ?? '', pb = b.posted_at ?? '';
    if (ra === 0) {
      // 임박: 마감 가까운 순(오름차순), 동률이면 최신 등록
      const cmp = da.localeCompare(db);
      return cmp !== 0 ? cmp : pb.localeCompare(pa);
    }
    if (ra === 1) {
      // 마감 지남: 최근에 지난 것부터(내림차순), 동률이면 최신 등록
      const cmp = db.localeCompare(da);
      return cmp !== 0 ? cmp : pb.localeCompare(pa);
    }
    // 마감 없음: 최신 등록순
    return pb.localeCompare(pa);
  });
}
