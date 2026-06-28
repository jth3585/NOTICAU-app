// keyword_alert_push — 매시간 정각, 지난 1시간 새 공지 중 유저 키워드(notify=true) 매칭 시 즉시 푸시.
// "키워드 '장학' 매칭 공지 3개" / 여러 키워드면 "키워드 '장학' 외 1개 매칭 공지 5개".
//
// 인증: verify_jwt=false 로 배포 + Authorization: Bearer <CRON_SECRET> 자체 검증.
// 윈도우: crawled_at >= now()-1h (학교가 과거 날짜로 올려도 우리 DB에 막 들어온 것 기준).
// 쿨다운: last_keyword_push_at 이 1시간 이내면 skip (cron 중복/재시도 시 연속 발송 방지).
// 매칭 로직(isMismatch / 키워드 매칭)은 daily_digest_push 와 동일하게 lib/matching.ts 포팅 (단일 파일 유지).
//
// TODO: 1만+ users 규모가 되면 유저별 루프 대신 RPC(서버사이드 SQL 집계)로 일괄 처리하여 최적화.

import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const HOUR_MS = 60 * 60 * 1000;

type Meta = {
  topic: string | null;
  target_grades: number[] | null;
  target_depts: string[] | null;
  target_campuses: string[] | null;
  target_enrollment_status: string[] | null;
  targets_freshmen: boolean | null;
  excludes_undergrad: boolean | null;
};
type Profile = {
  user_id: string;
  grade: number;
  campus: string;
  dept: string | null;
  dept_secondary: string | null;
  college: string | null;
  enrollment_status: string[];
  is_dormitory: boolean;
  last_keyword_push_at: string | null;
};

function one<T>(v: T | T[] | null): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
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

function isMismatch(
  notice: any,
  meta: Meta | null,
  profile: Profile,
  disabledTopics: Set<string>,
  readIds: Set<string>,
): boolean {
  if (readIds.has(notice.id)) return true;
  // 출처 캠퍼스 귀속: 특정 캠퍼스 게시판인데 내 캠퍼스가 아니면 제외 (meta 없어도 적용).
  const src = one<{ campus: string | null }>(notice.sources);
  if (src?.campus && src.campus !== "both" && !sourceCampusMatch(profile, src.campus)) return true;
  if (!meta) return false;
  if (meta.topic && disabledTopics.has(meta.topic)) return true;
  if (meta.target_grades && meta.target_grades.length > 0 && !meta.target_grades.includes(profile.grade)) return true;
  if (meta.target_campuses && meta.target_campuses.length > 0 && !campusMatch(profile, meta.target_campuses)) return true;
  if (meta.target_depts && meta.target_depts.length > 0) {
    const mine = [profile.dept, profile.dept_secondary, profile.college].filter(Boolean) as string[];
    if (!meta.target_depts.some((d) => mine.includes(d))) return true;
  }
  if (meta.target_enrollment_status && meta.target_enrollment_status.length > 0) {
    const userStatuses = new Set(profile.enrollment_status);
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
// 한글 포함 키워드는 조사·합성어 때문에 substring 유지("장학"→"장학금"). lib/matching.ts 와 동일.
function matchKeyword(haystack: string, keyword: string): boolean {
  const kw = keyword.toLowerCase();
  if (/^[a-z0-9]+$/i.test(keyword)) {
    return new RegExp(`\\b${escapeRegex(kw)}\\b`, "i").test(haystack);
  }
  return haystack.includes(kw);
}

function noticeHasKeyword(notice: any, keyword: string): boolean {
  const haystack = `${notice.title} ${notice.body_text ?? ""}`.toLowerCase();
  return matchKeyword(haystack, keyword);
}

Deno.serve(async (req) => {
  // ---- 인증 ----
  const cronSecret = Deno.env.get("CRON_SECRET");
  const auth = req.headers.get("Authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - HOUR_MS).toISOString();
  // 게시일 게이트: 백필(과거 날짜로 막 크롤링된 공지)로 알림이 울리지 않게 최근 게시분만.
  // 홈 키워드매치 탭(posted_at 48h)에 반드시 보이도록 그보다 좁은 24h로 둔다.
  const postWindowStart = new Date(now.getTime() - 24 * HOUR_MS).toISOString();

  // ---- 지난 1시간 새로 들어왔고(crawled_at), 게시일도 최근(posted_at)인 공지 ----
  const { data: notices, error: noticesErr } = await supabase
    .from("notices")
    .select("id, title, body_text, crawled_at, notice_meta(topic,target_grades,target_depts,target_campuses,target_enrollment_status,targets_freshmen,excludes_undergrad), sources(campus)")
    .gte("crawled_at", windowStart)
    .gte("posted_at", postWindowStart)
    .order("crawled_at", { ascending: false });
  if (noticesErr) {
    return new Response(JSON.stringify({ error: noticesErr.message }), { status: 500 });
  }
  const recent = notices ?? [];
  if (recent.length === 0) {
    return new Response(JSON.stringify({ sent_users: 0, message: "no new notices" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // ---- 알림 ON 유저 ----
  const { data: profiles, error: profErr } = await supabase
    .from("profiles")
    .select("user_id, grade, campus, dept, dept_secondary, college, enrollment_status, is_dormitory, last_keyword_push_at")
    .eq("notifications_enabled", true);
  if (profErr) {
    return new Response(JSON.stringify({ error: profErr.message }), { status: 500 });
  }

  const messages: any[] = [];
  const sentUserIds: string[] = [];
  let skippedCooldown = 0;

  for (const profile of (profiles ?? []) as Profile[]) {
    // 쿨다운: 1시간 이내 발송 이력이면 skip
    if (profile.last_keyword_push_at && now.getTime() - new Date(profile.last_keyword_push_at).getTime() < HOUR_MS) {
      skippedCooldown++;
      continue;
    }

    const uid = profile.user_id;
    const [kwRes, prefRes, readRes, tokRes] = await Promise.all([
      supabase.from("user_keywords").select("keyword").eq("user_id", uid).eq("notify", true),
      supabase.from("user_category_prefs").select("topic,is_enabled").eq("user_id", uid),
      supabase.from("user_feed_state").select("notice_id").eq("user_id", uid).not("read_at", "is", null),
      supabase.from("push_tokens").select("token").eq("user_id", uid).eq("is_active", true),
    ]);

    const keywords = ((kwRes.data ?? []) as any[]).map((k) => k.keyword);
    if (keywords.length === 0) continue; // notify 키워드 없으면 skip
    const tokens = ((tokRes.data ?? []) as any[]).map((t) => t.token);
    if (tokens.length === 0) continue;

    const disabledTopics = new Set<string>(
      ((prefRes.data ?? []) as any[]).filter((p) => !p.is_enabled).map((p) => p.topic),
    );
    const readIds = new Set<string>(((readRes.data ?? []) as any[]).map((r) => r.notice_id));

    // 미스매치 아닌 공지만 후보
    const candidates = recent.filter((n: any) => !isMismatch(n, one<Meta>(n.notice_meta), profile, disabledTopics, readIds));
    if (candidates.length === 0) continue;

    // 키워드별 매칭 공지 집합
    const perKeyword = new Map<string, Set<string>>();
    const matchedNoticeIds = new Set<string>();
    for (const kw of keywords) {
      const set = new Set<string>();
      for (const n of candidates) {
        if (noticeHasKeyword(n, kw)) {
          set.add(n.id);
          matchedNoticeIds.add(n.id);
        }
      }
      if (set.size > 0) perKeyword.set(kw, set);
    }

    const K = matchedNoticeIds.size; // 매칭 공지 수 (중복 제거)
    if (K === 0) continue;

    // 대표 키워드: 매칭 공지 수 최다 → 동수면 알파벳 순
    const rep = [...perKeyword.entries()].sort((a, b) => {
      if (b[1].size !== a[1].size) return b[1].size - a[1].size;
      return a[0].localeCompare(b[0]);
    })[0][0];
    const distinctKw = perKeyword.size;

    const body = distinctKw === 1
      ? `키워드 '${rep}' 매칭 공지 ${K}개`
      : `키워드 '${rep}' 외 ${distinctKw - 1}개 매칭 공지 ${K}개`;

    // 딥링크용: 매칭 공지 id (1개면 앱에서 바로 해당 글로, 여러 개면 키워드매치 탭으로)
    const noticeIds = [...matchedNoticeIds].slice(0, 20);
    for (const token of tokens) {
      messages.push({ to: token, sound: "default", title: "키워드 알림", body, data: { type: "keyword", noticeIds } });
    }
    sentUserIds.push(uid);
  }

  // ---- Expo Push 발송 (100개씩 배치) ----
  const pushResults: any[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chunk),
    });
    pushResults.push(await res.json());
  }

  // ---- last_keyword_push_at 갱신 (발송 유저만) ----
  if (sentUserIds.length > 0) {
    await supabase
      .from("profiles")
      .update({ last_keyword_push_at: now.toISOString() })
      .in("user_id", sentUserIds);
  }

  return new Response(
    JSON.stringify({
      sent_users: sentUserIds.length,
      sent_messages: messages.length,
      skipped_cooldown: skippedCooldown,
      new_notices: recent.length,
      push_results: pushResults,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
