// daily_digest_push — 매일 KST 18:00 공지 브리핑. (cron: '0 9 * * *' UTC = 18:00 KST)
// 모든 사용자의 알림함(notifications)에 하루 동안 새로 들어온 내 공지를 기록하고, notifications_enabled 가
// false 가 아니면 푸시도 보낸다. 제목 "오늘의 공지 브리핑" / 본문 "D-2 국가장학금 2차 신청 안내 외 11건".
//
// 인증: verify_jwt=false 로 배포 + Authorization: Bearer <CRON_SECRET> 자체 검증.
//
// 어떤 글을 세나(2026-11-18 개편)
//   - 분류가 끝난 시각(notice_meta.llm_processed_at)이 [실행 24시간 10분 전, 실행 10분 전) + 게시일 48시간 이내.
//     예전엔 게시일 기준 '지난 24시간'만 셌는데, 날짜만 있는 글은 00시로 저장되므로 18시 이후에 수집된
//     오늘 글은 오늘 브리핑엔 늦고 내일 브리핑 창엔 이미 지나서 어느 브리핑에도 안 들어갔다(게시판 글의 13%).
//     하루씩 이어 붙인 창이라 빠지는 글이 없다.
//   - 2026-11-21: 창 기준을 수집 시각(crawled_at) → 분류 완료 시각으로. 수집 시각 기준일 땐 18시에 아직 분류
//     안 된 글(분류 대기열이 밀린 날, 약 11%가 10분 넘게 걸림)이 대상 정보(notice_meta) 없이 들어가 학년·학과·
//     캠퍼스 조건을 건너뛰고 모든 사람 브리핑에 실렸다. 이제 분류가 끝난 글만, 끝난 날의 브리핑에 들어간다.
//   - 대상 판정은 _shared/audience.ts(앱 lib/matching.ts 포팅). 마감이 지난 신청형 공지는 뺀다.
//   - 본문 첫 글: 3일 안에 마감되는 신청형 공지 → 내 학과·단과대 글 → 최신 글 순으로 고른다.
//
// 하루 1회 가드: profiles.last_daily_push_at 이 오늘(KST)이면 건너뛴다(cron 재시도·수동 실행 대비).
// 시험: body {"dryRun": true} → 기록·발송 없이 누가 어떤 문구를 받을지만 돌려준다.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  chunk, EMPTY, isMismatch, loadUserContext, META_COLS, type Meta, myUnits, one, PROFILE_COLS, type Profile,
  selectAll, shortTitle, type Src,
} from "../_shared/audience.ts";
import { type PushMessage, sendPush } from "../_shared/push.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MIN_MS;
const LAG_MS = 10 * MIN_MS; // 창 끝을 실행 10분 전으로(예전 창과 이어지게 유지)
const POST_GATE_MS = 2 * DAY_MS; // 백필(과거 글 일괄 수집) 제외
const SOON_DAYS = 3; // 본문 첫 글로 올릴 마감 임박 기준

const TITLE = "오늘의 공지 브리핑";

type NoticeRow = {
  id: string;
  title: string | null;
  posted_at: string | null;
  notice_meta: Meta | Meta[] | null;
  sources: Src | Src[] | null;
};

type DigestProfile = Profile & { last_daily_push_at: string | null };

// KST 기준 YYYY-MM-DD
function kstDate(d: Date | number): string {
  return new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

// 마감까지 남은 날(KST 날짜 기준). 오늘 마감이면 0.
function daysLeft(deadline: string, now: number): number {
  const a = Date.parse(`${kstDate(now)}T00:00:00Z`);
  const b = Date.parse(`${kstDate(Date.parse(deadline))}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

// actionable인데 마감일이 지난 공지는 브리핑에서 제외 (이미 신청 종료 → 무의미).
function isExpiredActionable(meta: Meta | null, now: number): boolean {
  return !!meta && meta.action === "actionable" && !!meta.deadline_at && Date.parse(meta.deadline_at) < now;
}

function soonDeadline(meta: Meta | null, now: number): number | null {
  if (!meta || meta.action !== "actionable" || !meta.deadline_at) return null;
  const d = daysLeft(meta.deadline_at, now);
  return d >= 0 && d <= SOON_DAYS ? d : null;
}

function isMine(n: NoticeRow, meta: Meta | null, profile: Profile): boolean {
  const mine = myUnits(profile);
  const src = one<Src>(n.sources);
  if (src?.owner_unit && mine.includes(src.owner_unit)) return true;
  return !!meta?.target_depts?.some((d) => mine.includes(d));
}

// 첫 글(본문에 제목이 나갈 글)을 앞으로: 마감 임박(가까운 순) → 내 소속 → 나머지(최신순, 입력 순서 유지)
function orderForDigest(list: NoticeRow[], profile: Profile, now: number): { ordered: NoticeRow[]; dday: number | null } {
  const rank = (n: NoticeRow) => {
    const meta = one<Meta>(n.notice_meta);
    const d = soonDeadline(meta, now);
    if (d !== null) return d; // 0~3
    return isMine(n, meta, profile) ? 10 : 20;
  };
  const ordered = list.map((n, i) => ({ n, i, r: rank(n) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.n);
  const dday = soonDeadline(one<Meta>(ordered[0].notice_meta), now);
  return { ordered, dday };
}

function digestBody(ordered: NoticeRow[], dday: number | null): string {
  const prefix = dday === null ? "" : dday === 0 ? "D-day " : `D-${dday} `;
  const first = `${prefix}${shortTitle(ordered[0].title, 50)}`;
  return ordered.length === 1 ? first : `${first} 외 ${ordered.length - 1}건`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("Authorization") !== `Bearer ${cronSecret}`) {
    return json({ error: "Unauthorized" }, 401);
  }
  let reqBody: { dryRun?: boolean } = {};
  try { reqBody = await req.json(); } catch { /* cron 빈 body */ }
  const dryRun = reqBody.dryRun === true;

  try {
    const now = Date.now();
    const todayKst = kstDate(now);
    const windowEnd = now - LAG_MS;
    const windowStart = windowEnd - DAY_MS;

    const { data: noticeData, error: noticesErr } = await supabase
      .from("notices")
      .select(`id, title, posted_at, notice_meta!inner(${META_COLS}), sources(campus,owner_unit,parser_key)`)
      .is("duplicate_of", null) // 교차출처 중복은 대표 1건만
      .eq("channel", "board") // 인스타 공지는 브리핑 대상 아님
      .gte("notice_meta.llm_processed_at", new Date(windowStart).toISOString())
      .lt("notice_meta.llm_processed_at", new Date(windowEnd).toISOString())
      .gte("posted_at", new Date(now - POST_GATE_MS).toISOString())
      .order("posted_at", { ascending: false })
      .limit(1000);
    if (noticesErr) return json({ error: noticesErr.message }, 500);
    const recent = (noticeData ?? []) as unknown as NoticeRow[];
    if (recent.length === 0) return json({ sent_users: 0, message: "no new notices" });

    // 푸시를 꺼 둔 사람도 알림함 기록 대상이라 notifications_enabled 로 거르지 않는다(발송 단계에서 판단).
    const profiles = await selectAll<DigestProfile>(() =>
      supabase.from("profiles").select(`${PROFILE_COLS}, last_daily_push_at`).order("user_id"));
    const sentToday = (p: DigestProfile) => !!p.last_daily_push_at && kstDate(Date.parse(p.last_daily_push_at)) === todayKst;
    // dryRun 은 오늘 이미 받은 사람도 포함해 미리 본다(가드 건수는 따로 알려 줌).
    const todo = dryRun ? profiles : profiles.filter((p) => !sentToday(p));
    const ctx = await loadUserContext(supabase, todo.map((p) => p.user_id), recent.map((n) => n.id));

    const pending: { user_id: string; body: string; notice_ids: string[]; pushed: boolean; tokens: string[] }[] = [];
    for (const profile of todo) {
      const uid = profile.user_id;
      const matched = recent.filter((n) => {
        const meta = one<Meta>(n.notice_meta);
        return !isExpiredActionable(meta, now) && !isMismatch(n, meta, profile,
          ctx.disabledTopics.get(uid) ?? EMPTY, ctx.readIds.get(uid) ?? EMPTY, ctx.disabledSources.get(uid) ?? EMPTY);
      });
      if (matched.length === 0) continue; // 보낼 게 없으면 생략 (last_daily_push_at 미갱신)

      const { ordered, dday } = orderForDigest(matched, profile, now);
      const tokens = ctx.tokens.get(uid) ?? [];
      const canPush = profile.notifications_enabled !== false && tokens.length > 0;
      pending.push({
        user_id: uid,
        body: digestBody(ordered, dday),
        notice_ids: ordered.slice(0, 100).map((n) => n.id),
        pushed: canPush,
        tokens: canPush ? tokens : [],
      });
    }

    if (dryRun) {
      const counts = pending.map((p) => p.notice_ids.length).sort((a, b) => a - b);
      return json({
        dryRun: true, recent_notices: recent.length, profiles: profiles.length,
        already_sent_today: profiles.filter(sentToday).length, would_notify: pending.length,
        would_push_messages: pending.reduce((s, p) => s + p.tokens.length, 0),
        median_notices: counts[Math.floor(counts.length / 2)] ?? 0,
        samples: pending.slice(0, 20).map((p) => ({ body: p.body, notices: p.notice_ids.length, push: p.pushed })),
      });
    }

    // 알림함 기록 → id 를 푸시 data 에 실어 앱이 그 알림의 공지 모음으로 이동.
    // 기록에 실패한 사람에게는 푸시를 보내지 않고 하루 1회 가드도 갱신하지 않는다.
    const idByUser = new Map<string, string>();
    let insertErrors = 0;
    for (const part of chunk(pending, 500)) {
      const { data: inserted, error } = await supabase.from("notifications")
        .insert(part.map(({ tokens: _t, ...row }) => ({ ...row, type: "digest", title: TITLE })))
        .select("id, user_id");
      if (error) { insertErrors += part.length; console.error(`notifications insert failed: ${error.message}`); continue; }
      for (const r of (inserted ?? []) as { id: string; user_id: string }[]) idByUser.set(r.user_id, r.id);
    }

    const messages: PushMessage[] = [];
    for (const p of pending) {
      const notificationId = idByUser.get(p.user_id);
      if (!notificationId) continue;
      for (const token of p.tokens) {
        // 공지 id 목록은 data 4KB 한도 때문에 싣지 않고 notificationId 로 앱이 조회
        messages.push({
          to: token, sound: "default", channelId: "digest", title: TITLE, body: p.body,
          data: { type: "digest", notificationId },
        });
      }
    }
    const push = await sendPush(supabase, messages);

    const notified = [...idByUser.keys()];
    for (const part of chunk(notified, 100)) {
      await supabase.from("profiles").update({ last_daily_push_at: new Date(now).toISOString() }).in("user_id", part);
    }

    return json({
      sent_users: notified.length,
      insert_errors: insertErrors,
      skipped_already_sent: profiles.length - todo.length,
      recent_notices: recent.length,
      push,
    });
  } catch (e) {
    console.error(`daily_digest_push failed: ${(e as Error).message}`);
    return json({ error: (e as Error).message }, 500);
  }
});
