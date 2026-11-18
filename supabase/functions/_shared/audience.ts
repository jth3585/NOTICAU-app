// 푸시 대상 판정 공통 모듈 — keyword_alert_push / daily_digest_push 가 함께 쓴다.
//
// isMismatch·matchKeyword 는 앱 lib/matching.ts 를 그대로 옮긴 것이다(Deno 에서 앱 코드를 import 할 수 없음).
// 앱의 피드·홈 키워드 탭과 푸시가 같은 글을 보여 줘야 하므로, lib/matching.ts 를 고치면 여기도 같이 고칠 것.
//
// load* 함수는 PostgREST 기본 행 한도(1,000행)에 잘리지 않게 range 로 끝까지 읽거나 id 를 나눠 조회한다.

// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type Meta = {
  topic: string | null;
  action?: string | null;
  deadline_at?: string | null;
  target_grades: number[] | null;
  target_depts: string[] | null;
  target_campuses: string[] | null;
  target_enrollment_status: string[] | null;
  targets_freshmen: boolean | null;
  excludes_undergrad: boolean | null;
};

export type Src = { campus: string | null; owner_unit: string | null; parser_key: string | null };

export type Profile = {
  user_id: string;
  grade: number;
  campus: string;
  dept: string | null;
  dept_secondary: string | null;
  college: string | null;
  enrollment_status: string[] | null;
  is_dormitory: boolean;
  show_cross_dept: boolean | null;
  notifications_enabled: boolean | null;
};

export const PROFILE_COLS =
  "user_id, grade, campus, dept, dept_secondary, college, enrollment_status, is_dormitory, show_cross_dept, notifications_enabled";

export const META_COLS =
  "topic,action,deadline_at,target_grades,target_depts,target_campuses,target_enrollment_status,targets_freshmen,excludes_undergrad";

// PostgREST 임베드는 객체/배열 둘 다 가능 → 단일 객체로 정규화.
export function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function myUnits(p: Profile): string[] {
  return [p.dept, p.dept_secondary, p.college].filter(Boolean) as string[];
}

// ---- lib/matching.ts 포팅 ----
function campusMatch(profile: Profile, targetCampuses: string[]): boolean {
  if (targetCampuses.includes(profile.campus)) return true;
  if (profile.campus === "davinci" && targetCampuses.includes("anseong")) return true;
  return false;
}

// 출처(게시판) 자체의 캠퍼스 귀속. 'both'(본교)·null은 모든 캠퍼스 통과.
function sourceCampusMatch(profile: Profile, sourceCampus: string): boolean {
  if (sourceCampus === profile.campus) return true;
  if (sourceCampus === "anseong" && profile.campus === "davinci") return true;
  return false;
}

export function isMismatch(
  notice: { id: string; sources?: any },
  meta: Meta | null,
  profile: Profile,
  disabledTopics: Set<string>,
  readIds: Set<string>,
  disabledSources: Set<string>,
): boolean {
  if (readIds.has(notice.id)) return true;
  // 출처 캠퍼스 귀속: 특정 캠퍼스 게시판인데 내 캠퍼스가 아니면 제외 (meta 없어도 적용).
  const src = one<Src>(notice.sources);
  if (src?.campus && src.campus !== "both" && !sourceCampusMatch(profile, src.campus)) return true;

  // 타 학과 게시판의 전체대상 공지(target_depts 없음): 마스터 토글 off거나 학과별로 끈 게시판이면 제외.
  if (src?.owner_unit) {
    const isOther = !myUnits(profile).includes(src.owner_unit);
    const noDeptTarget = !meta?.target_depts || meta.target_depts.length === 0;
    if (isOther && noDeptTarget) {
      if (profile.show_cross_dept === false) return true;
      if (src.parser_key && disabledSources.has(src.parser_key)) return true;
    }
  }

  if (!meta) return false;
  if (meta.topic && disabledTopics.has(meta.topic)) return true;
  if (meta.target_grades && meta.target_grades.length > 0 && !meta.target_grades.includes(profile.grade)) return true;
  if (meta.target_campuses && meta.target_campuses.length > 0 && !campusMatch(profile, meta.target_campuses)) return true;
  if (meta.target_depts && meta.target_depts.length > 0) {
    const mine = myUnits(profile);
    if (!meta.target_depts.some((d) => mine.includes(d))) return true;
  }
  if (meta.target_enrollment_status && meta.target_enrollment_status.length > 0) {
    const userStatuses = new Set(profile.enrollment_status ?? []);
    if (!meta.target_enrollment_status.some((s) => userStatuses.has(s))) return true;
  }
  if (meta.targets_freshmen && profile.grade !== 1) return true;
  if (meta.excludes_undergrad) return true;
  if (meta.topic === "기숙사" && !profile.is_dormitory) return true;
  return false;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 영문/숫자 키워드는 단어 경계(\b)로 정밀 매칭("ai"가 "Detailed"에 걸리는 오탐 방지),
// 한글 포함 키워드는 조사·합성어 때문에 substring 유지("장학"→"장학금").
export function matchKeyword(haystack: string, keyword: string): boolean {
  const kw = keyword.toLowerCase();
  if (/^[a-z0-9]+$/i.test(keyword)) {
    return new RegExp(`\\b${escapeRegex(kw)}\\b`, "i").test(haystack);
  }
  return haystack.includes(kw);
}

export function noticeHasKeyword(
  notice: { title: string | null; body_text: string | null },
  kw: { keyword: string; title_only?: boolean },
): boolean {
  const haystack = (kw.title_only ? (notice.title ?? "") : `${notice.title ?? ""} ${notice.body_text ?? ""}`).toLowerCase();
  return matchKeyword(haystack, kw.keyword);
}

// 푸시 본문에 넣을 공지 제목: 공백 정리 + 길면 자르기(잠금화면에서는 어차피 OS 가 줄임표 처리).
export function shortTitle(title: string | null | undefined, max = 60): string {
  const t = (title ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ---- 일괄 조회 ----

// range 로 끝까지 읽는다. build 는 매번 새 쿼리를 만들어야 한다(같은 빌더 재사용 불가).
export async function selectAll<T>(build: () => any, page = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await build().range(from, from + page - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < page) break;
  }
  return out;
}

// user_id 목록을 나눠 조회(URL 길이 한도) + 각 조각은 range 로 끝까지.
export async function selectByUsers<T>(
  userIds: string[],
  build: (ids: string[]) => any,
  size = 100, // in() 필터가 URL 에 들어가므로 uuid 100개(약 4KB) 안쪽으로
): Promise<T[]> {
  const out: T[] = [];
  for (const part of chunk(userIds, size)) out.push(...(await selectAll<T>(() => build(part))));
  return out;
}

export function groupBy<T, V>(rows: T[], key: (r: T) => string, val: (r: T) => V): Map<string, V[]> {
  const m = new Map<string, V[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(val(r)); else m.set(k, [val(r)]);
  }
  return m;
}

// 사용자별 필터 재료(끈 카테고리·끈 게시판·이번 후보 중 읽은 글·활성 토큰)를 한 번에 읽는다.
export type UserContext = {
  disabledTopics: Map<string, Set<string>>;
  disabledSources: Map<string, Set<string>>;
  readIds: Map<string, Set<string>>;
  tokens: Map<string, string[]>;
};

export async function loadUserContext(
  supabase: SupabaseClient,
  userIds: string[],
  noticeIds: string[],
): Promise<UserContext> {
  const [topics, sources, tokens] = await Promise.all([
    selectByUsers<{ user_id: string; topic: string }>(userIds, (ids) =>
      supabase.from("user_category_prefs").select("user_id, topic").in("user_id", ids).eq("is_enabled", false)
        .order("user_id").order("topic")),
    selectByUsers<{ user_id: string; parser_key: string }>(userIds, (ids) =>
      supabase.from("user_source_prefs").select("user_id, parser_key").in("user_id", ids).eq("is_enabled", false)
        .order("user_id").order("parser_key")),
    selectByUsers<{ user_id: string; token: string }>(userIds, (ids) =>
      supabase.from("push_tokens").select("user_id, token").in("user_id", ids).eq("is_active", true).order("token")),
  ]);
  // 읽은 글은 이번 후보 공지로 한정해서 읽는다(사용자별 전체 읽음 기록을 다 가져오지 않음).
  const reads: { user_id: string; notice_id: string }[] = [];
  for (const nPart of chunk(noticeIds, 60)) {
    reads.push(...(await selectByUsers<{ user_id: string; notice_id: string }>(userIds, (ids) =>
      supabase.from("user_feed_state").select("user_id, notice_id").in("user_id", ids).in("notice_id", nPart)
        .not("read_at", "is", null).order("user_id").order("notice_id"), 60)));
  }
  const toSet = (m: Map<string, string[]>) => new Map([...m].map(([k, v]) => [k, new Set(v)]));
  return {
    disabledTopics: toSet(groupBy(topics, (r) => r.user_id, (r) => r.topic)),
    disabledSources: toSet(groupBy(sources, (r) => r.user_id, (r) => r.parser_key)),
    readIds: toSet(groupBy(reads, (r) => r.user_id, (r) => r.notice_id)),
    tokens: groupBy(tokens, (r) => r.user_id, (r) => r.token),
  };
}

export const EMPTY = new Set<string>();
