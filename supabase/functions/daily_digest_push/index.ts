// daily_digest_push — 매일 KST 18:00 데일리 다이제스트 푸시. (cron: '0 9 * * *' UTC = 18:00 KST)
// notifications_enabled=true 인 유저에게 "오늘 새 공지 N개 (키워드 매칭 M개)" 발송.
//
// 인증: verify_jwt=false 로 배포 + Authorization: Bearer <CRON_SECRET> 자체 검증.
// 매칭 로직(isMismatch / 키워드 매칭)은 앱 lib/matching.ts 를 그대로 포팅 (Deno에서 app import 불가).
//
// TODO: 1만+ users 규모가 되면 유저별 루프 대신 RPC(서버사이드 SQL 집계)로 일괄 처리하여 최적화.

import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const DAY_MS = 24 * 60 * 60 * 1000;

// ---- 타입 (느슨하게) ----
type Meta = {
  topic: string | null;
  action: string | null;
  deadline_at: string | null;
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
  show_cross_dept: boolean | null;
  last_daily_push_at: string | null;
};

// PostgREST 임베드는 객체/배열 둘 다 가능 → 단일 객체로 정규화.
function one<T>(v: T | T[] | null): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

// actionable인데 마감일이 지난 공지는 디지스트에서 제외 (이미 신청 종료 → 무의미).
function isExpiredActionable(meta: Meta | null): boolean {
  return !!meta && meta.action === "actionable" && !!meta.deadline_at
    && new Date(meta.deadline_at).getTime() < Date.now();
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
  disabledSources: Set<string>,
): boolean {
  if (readIds.has(notice.id)) return true;
  // 출처 캠퍼스 귀속: 특정 캠퍼스 게시판인데 내 캠퍼스가 아니면 제외 (meta 없어도 적용).
  const src = one<{ campus: string | null; owner_unit: string | null; parser_key: string | null }>(notice.sources);
  if (src?.campus && src.campus !== "both" && !sourceCampusMatch(profile, src.campus)) return true;

  // 타 학과 게시판의 전체대상 공지(target_depts 없음): 마스터 토글 off거나 학과별로 끈 게시판이면 제외.
  // (앱 피드의 lib/matching.ts isMismatch와 동일 규칙 → 다이제스트 푸시를 피드와 일치시킴.)
  if (src?.owner_unit) {
    const mine = [profile.dept, profile.dept_secondary, profile.college].filter(Boolean) as string[];
    const isOther = !mine.includes(src.owner_unit);
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


// KST 기준 YYYY-MM-DD
function kstDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

Deno.serve(async (req) => {
  // ---- 인증 ----
  const cronSecret = Deno.env.get("CRON_SECRET");
  const auth = req.headers.get("Authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const now = new Date();
  const todayKst = kstDate(now);
  const windowStart = new Date(now.getTime() - DAY_MS).toISOString();

  // ---- 최근 공지 1회 fetch (유저 루프 밖) ----
  const { data: notices, error: noticesErr } = await supabase
    .from("notices")
    .select("id, title, body_text, posted_at, notice_meta(topic,action,deadline_at,target_grades,target_depts,target_campuses,target_enrollment_status,targets_freshmen,excludes_undergrad), sources(campus,owner_unit,parser_key)")
    .order("posted_at", { ascending: false })
    .limit(300);
  if (noticesErr) {
    return new Response(JSON.stringify({ error: noticesErr.message }), { status: 500 });
  }

  // 최근 24h 내 공지만 추림
  const recent = (notices ?? []).filter((n: any) => n.posted_at && n.posted_at >= windowStart);

  // ---- 알림 ON 유저 ----
  const { data: profiles, error: profErr } = await supabase
    .from("profiles")
    .select("user_id, grade, campus, dept, dept_secondary, college, enrollment_status, is_dormitory, show_cross_dept, last_daily_push_at")
    .eq("notifications_enabled", true);
  if (profErr) {
    return new Response(JSON.stringify({ error: profErr.message }), { status: 500 });
  }

  const messages: any[] = [];
  const sentUserIds: string[] = [];
  let skippedAlreadySent = 0;

  for (const profile of (profiles ?? []) as Profile[]) {
    // 중복 발송 방지: 오늘(KST) 이미 발송했으면 skip
    if (profile.last_daily_push_at && kstDate(new Date(profile.last_daily_push_at)) === todayKst) {
      skippedAlreadySent++;
      continue;
    }

    const uid = profile.user_id;
    const [prefRes, srcPrefRes, readRes, tokRes] = await Promise.all([
      supabase.from("user_category_prefs").select("topic,is_enabled").eq("user_id", uid),
      supabase.from("user_source_prefs").select("parser_key").eq("user_id", uid).eq("is_enabled", false),
      supabase.from("user_feed_state").select("notice_id").eq("user_id", uid).not("read_at", "is", null),
      supabase.from("push_tokens").select("token").eq("user_id", uid).eq("is_active", true),
    ]);

    const disabledTopics = new Set<string>(
      ((prefRes.data ?? []) as any[]).filter((p) => !p.is_enabled).map((p) => p.topic),
    );
    const disabledSources = new Set<string>(((srcPrefRes.data ?? []) as any[]).map((r) => r.parser_key));
    const readIds = new Set<string>(((readRes.data ?? []) as any[]).map((r) => r.notice_id));
    const tokens = ((tokRes.data ?? []) as any[]).map((t) => t.token);
    if (tokens.length === 0) continue;

    // N = 미스매치 아닌(미만료) 최근 공지 수
    const matched = recent.filter((n: any) => {
      const meta = one<Meta>(n.notice_meta);
      return !isMismatch(n, meta, profile, disabledTopics, readIds, disabledSources) && !isExpiredActionable(meta);
    });
    const N = matched.length;
    if (N === 0) continue; // 보낼 게 없으면 생략 (last_daily_push_at 미갱신)

    const body = `오늘 새 공지 ${N}건`;

    // 브리핑은 집계형 → 특정 글 딥링크 없음(앱만 열림). type만 표기.
    for (const token of tokens) {
      messages.push({ to: token, sound: "default", title: "NOTICAU", body, data: { type: "digest" } });
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

  // ---- last_daily_push_at 갱신 (발송 유저만) ----
  if (sentUserIds.length > 0) {
    await supabase
      .from("profiles")
      .update({ last_daily_push_at: now.toISOString() })
      .in("user_id", sentUserIds);
  }

  return new Response(
    JSON.stringify({
      sent_users: sentUserIds.length,
      sent_messages: messages.length,
      skipped_already_sent: skippedAlreadySent,
      recent_notices: recent.length,
      push_results: pushResults,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
