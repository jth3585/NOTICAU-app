// keyword_alert_push — 매시간 정각. 새 공지 중 사용자 키워드(notify=true)가 걸린 글을 알림함에 기록하고 푸시한다.
//   제목 "‘장학’ 새 공지" / 본문 "2026-2학기 국가장학금 2차 신청 안내 외 2건".
//
// 인증: verify_jwt=false 로 배포 + Authorization: Bearer <CRON_SECRET> 자체 검증.
//
// 어떤 글을 보나(2026-11-18 개편)
//   - 수집 시각(crawled_at) 기준 지난 2시간 + 게시일 24시간 이내 + 분류(notice_meta)가 끝난 글.
//     매시 실행인데 2시간을 보는 건 일부러다: 정각 직전에 들어와 아직 분류되지 않은 글, cron 이 늦거나
//     실패한 시간의 글을 다음 실행이 줍는다. 예전엔 '1시간 창 + 1시간 쿨다운'이라 실행 시작이 몇 초만
//     앞당겨져도 그 사람을 건너뛰었고, 그 시간 글은 영영 알림이 안 갔다.
//   - 겹치는 1시간 때문에 같은 글이 두 번 가지 않도록, 최근 3시간 안에 그 사람에게 키워드 알림으로
//     이미 보낸 공지(notifications.notice_ids)는 뺀다. 쿨다운은 없다.
//   - 대상 판정은 _shared/audience.ts(앱 lib/matching.ts 포팅) — 숨긴 학과 게시판도 앱과 똑같이 뺀다.
//
// 그 밖에: 푸시를 꺼 둔 사람도 알림함에는 기록한다. 기록에 실패하면 푸시도 보내지 않는다(다음 실행이 다시 시도).
// 매 실행 처음에 지난 발송의 Expo 영수증을 확인해 앱을 지운 기기의 토큰을 비활성화한다(_shared/push.ts).
//
// 시험: body {"dryRun": true} → 기록·발송 없이 누가 어떤 문구를 받을지만 돌려준다.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  chunk, EMPTY, groupBy, isMismatch, loadUserContext, META_COLS, type Meta, noticeHasKeyword, one,
  PROFILE_COLS, type Profile, selectAll, selectByUsers, shortTitle,
} from "../_shared/audience.ts";
import { checkReceipts, type PushMessage, sendPush } from "../_shared/push.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_MS = 2 * HOUR_MS; // 수집 시각 창
const POST_WINDOW_MS = 24 * HOUR_MS; // 게시일 게이트: 백필(과거 글 일괄 수집)로 알림이 울리지 않게. 홈 키워드 탭과 같은 24시간.
const SENT_LOOKBACK_MS = 3 * HOUR_MS; // 이미 보낸 공지 확인 범위(창보다 길게)

type NoticeRow = {
  id: string;
  title: string | null;
  body_text: string | null;
  crawled_at: string;
  notice_meta: Meta | Meta[] | null;
  sources: unknown;
};

type Pending = {
  user_id: string;
  type: "keyword";
  title: string;
  body: string;
  notice_ids: string[];
  data: Record<string, unknown>;
  pushed: boolean;
  tokens: string[];
};

const q = (k: string) => `‘${k}’`;

// 많이 걸린 키워드 순으로 받은 목록 → 알림 제목
function keywordTitle(kws: string[]): string {
  if (kws.length === 1) return `${q(kws[0])} 새 공지`;
  if (kws.length === 2) return `${q(kws[0])}·${q(kws[1])} 새 공지`;
  return `${q(kws[0])} 외 ${kws.length - 1}개 키워드 새 공지`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("Authorization") !== `Bearer ${cronSecret}`) {
    return json({ error: "Unauthorized" }, 401);
  }
  let reqBody: { dryRun?: boolean; windowHours?: number } = {};
  try { reqBody = await req.json(); } catch { /* cron 빈 body */ }
  const dryRun = reqBody.dryRun === true;
  // 시험용: dryRun 에서만 수집 창을 넓혀 볼 수 있다(최대 24시간).
  const windowMs = dryRun && Number.isFinite(reqBody.windowHours)
    ? Math.min(Math.max(reqBody.windowHours as number, 1), 24) * HOUR_MS : WINDOW_MS;

  try {
    const receipts = dryRun ? null : await checkReceipts(supabase);

    const now = Date.now();
    const { data: noticeData, error: noticesErr } = await supabase
      .from("notices")
      .select(`id, title, body_text, crawled_at, notice_meta!inner(${META_COLS}), sources(campus,owner_unit,parser_key)`)
      .is("duplicate_of", null) // 교차출처 중복은 대표 1건만
      .eq("channel", "board") // 인스타 공지는 키워드 알림 대상 아님
      .gte("crawled_at", new Date(now - windowMs).toISOString())
      .gte("posted_at", new Date(now - POST_WINDOW_MS).toISOString())
      .order("crawled_at", { ascending: false })
      .limit(1000);
    if (noticesErr) return json({ error: noticesErr.message }, 500);
    const notices = (noticeData ?? []) as unknown as NoticeRow[];
    if (notices.length === 0) return json({ sent_users: 0, message: "no new notices", receipts });

    // 키워드 알림을 켠 사람만 돈다(전체 프로필이 아니라).
    const kwRows = await selectAll<{ user_id: string; keyword: string; title_only: boolean | null }>(() =>
      supabase.from("user_keywords").select("user_id, keyword, title_only").eq("notify", true)
        .order("user_id").order("keyword"));
    const kwByUser = groupBy(kwRows, (r) => r.user_id, (r) => ({ keyword: r.keyword, title_only: !!r.title_only }));
    const kwUserIds = [...kwByUser.keys()];
    if (kwUserIds.length === 0) return json({ sent_users: 0, message: "no keyword users", receipts });

    const profiles = await selectByUsers<Profile>(kwUserIds, (ids) =>
      supabase.from("profiles").select(PROFILE_COLS).in("user_id", ids).order("user_id"));
    const userIds = profiles.map((p) => p.user_id);
    const ctx = await loadUserContext(supabase, userIds, notices.map((n) => n.id));

    const sentRows = await selectByUsers<{ user_id: string; notice_ids: string[] | null }>(userIds, (ids) =>
      supabase.from("notifications").select("user_id, notice_ids").eq("type", "keyword")
        .gte("created_at", new Date(now - Math.max(SENT_LOOKBACK_MS, windowMs + HOUR_MS)).toISOString()).in("user_id", ids).order("created_at"));
    const alreadySent = new Map<string, Set<string>>();
    for (const r of sentRows) {
      let set = alreadySent.get(r.user_id);
      if (!set) alreadySent.set(r.user_id, set = new Set());
      for (const id of r.notice_ids ?? []) set.add(id);
    }

    const pending: Pending[] = [];
    let skippedAlreadySent = 0;
    for (const profile of profiles) {
      const uid = profile.user_id;
      const kws = kwByUser.get(uid) ?? [];
      const sent = alreadySent.get(uid) ?? EMPTY;
      // 진단: 창이 겹쳐 다시 걸렸지만 이미 보낸 글이라 뺀 사람 수
      if (notices.some((n) => sent.has(n.id) && kws.some((kw) => noticeHasKeyword(n, kw)))) skippedAlreadySent++;
      const candidates = notices.filter((n) => {
        if (sent.has(n.id)) return false;
        return !isMismatch(n, one<Meta>(n.notice_meta), profile,
          ctx.disabledTopics.get(uid) ?? EMPTY, ctx.readIds.get(uid) ?? EMPTY, ctx.disabledSources.get(uid) ?? EMPTY);
      });
      if (candidates.length === 0) continue;

      // 키워드별로 걸린 공지(최근 수집 순)
      const perKeyword = new Map<string, NoticeRow[]>();
      for (const kw of kws) {
        const hits = candidates.filter((n) => noticeHasKeyword(n, kw));
        if (hits.length > 0) perKeyword.set(kw.keyword, hits);
      }
      if (perKeyword.size === 0) continue;

      // 많이 걸린 키워드 먼저, 같으면 가나다순. 공지 순서도 대표 키워드의 최신 글부터.
      const ranked = [...perKeyword.entries()].sort((a, b) =>
        b[1].length - a[1].length || a[0].localeCompare(b[0]));
      const ordered: NoticeRow[] = [];
      const seen = new Set<string>();
      for (const [, hits] of ranked) {
        for (const n of hits) if (!seen.has(n.id)) { seen.add(n.id); ordered.push(n); }
      }
      const K = ordered.length;
      const tokens = ctx.tokens.get(uid) ?? [];
      const canPush = profile.notifications_enabled !== false && tokens.length > 0;
      pending.push({
        user_id: uid,
        type: "keyword",
        title: keywordTitle(ranked.map(([k]) => k)),
        body: K === 1 ? shortTitle(ordered[0].title) : `${shortTitle(ordered[0].title, 50)} 외 ${K - 1}건`,
        notice_ids: ordered.slice(0, 50).map((n) => n.id),
        data: { keywords: ranked.map(([k]) => k) },
        pushed: canPush,
        tokens: canPush ? tokens : [],
      });
    }

    if (dryRun) {
      return json({
        dryRun: true, new_notices: notices.length, keyword_users: kwUserIds.length, would_notify: pending.length,
        would_push_messages: pending.reduce((s, p) => s + p.tokens.length, 0), skipped_already_sent: skippedAlreadySent,
        samples: pending.slice(0, 20).map((p) => ({ title: p.title, body: p.body, notices: p.notice_ids.length, push: p.pushed })),
      });
    }

    // 알림함 기록 → 생성된 id 를 푸시 data 에 실어 앱이 그 알림의 공지(들)로 이동하게 한다.
    // 기록에 실패한 사람에게는 푸시도 보내지 않는다(다음 실행에서 이미 보낸 글로 잡히지 않으니 다시 시도된다).
    const idByUser = new Map<string, string>();
    let insertErrors = 0;
    for (const part of chunk(pending, 500)) {
      const { data: inserted, error } = await supabase.from("notifications")
        .insert(part.map(({ tokens: _t, ...row }) => row)).select("id, user_id");
      if (error) { insertErrors += part.length; console.error(`notifications insert failed: ${error.message}`); continue; }
      for (const r of (inserted ?? []) as { id: string; user_id: string }[]) idByUser.set(r.user_id, r.id);
    }

    const messages: PushMessage[] = [];
    for (const p of pending) {
      const notificationId = idByUser.get(p.user_id);
      if (!notificationId) continue;
      for (const token of p.tokens) {
        messages.push({
          to: token, sound: "default", channelId: "keyword", priority: "high", title: p.title, body: p.body,
          data: { type: p.type, noticeIds: p.notice_ids, notificationId },
        });
      }
    }
    const push = await sendPush(supabase, messages);

    // 마지막 키워드 알림 시각(진단용 — 발송 판단에는 더 이상 쓰지 않는다)
    const notified = [...idByUser.keys()];
    for (const part of chunk(notified, 100)) {
      await supabase.from("profiles").update({ last_keyword_push_at: new Date(now).toISOString() }).in("user_id", part);
    }

    return json({
      sent_users: notified.length,
      insert_errors: insertErrors,
      skipped_already_sent: skippedAlreadySent,
      new_notices: notices.length,
      keyword_users: kwUserIds.length,
      push,
      receipts,
    });
  } catch (e) {
    console.error(`keyword_alert_push failed: ${(e as Error).message}`);
    return json({ error: (e as Error).message }, 500);
  }
});
