// crawler_watch — 매일 09:30 KST. 크롤러 문제를 관리자 폰으로 알린다.
//
// crawler_watch_issues() (마이그레이션 20261118020000_crawler_watch) 가 지금 문제인 소스를 돌려준다:
//   error(6시간+ 연속 실패) / stalled(26시간+ 실행 기록 없음) / quiet(새 글이 평소보다 너무 오래 없음, 한 번도 수집 안 됨)
// 이 결과를 crawler_alerts(열린 알림)와 비교해
//   - 새로 생긴 문제는 열고 바로 알린다
//   - 계속되는 문제는 7일마다 다시 알린다(관리자가 아직 없어서 못 알린 것도 여기서 알린다)
//   - 사라진 문제는 닫고 '복구'로 알린다
// 받는 사람: ops_admins 의 user_id 들의 활성 푸시 토큰. 알림함(notifications)에는 기록하지 않는다(운영용).
// 원래 글이 드문 게시판은 sources.watch_quiet_ok_until 로 quiet 판정을 기간 동안 끈다(watch_note 에 이유).
//
// 인증: verify_jwt=false + Authorization: Bearer <CRON_SECRET>.
// 시험: body {"dryRun": true} → 기록·발송 없이 판정만 돌려준다.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "jsr:@supabase/supabase-js@2.119.0";
import { type PushMessage, sendPush } from "../_shared/push.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const REMIND_MS = 7 * 24 * 60 * 60 * 1000;

type Issue = { source_id: string; parser_key: string; name: string; kind: string; detail: string };
type Alert = { id: number; source_id: string; kind: string; last_notified_at: string | null };

const KIND_LABEL: Record<string, string> = { error: "수집 실패", stalled: "실행 멈춤", quiet: "새 글 없음" };
const key = (sourceId: string, kind: string) => `${sourceId}|${kind}`;

function summarize(list: { name: string; kind: string }[], max = 2): string {
  const head = list.slice(0, max).map((i) => `${i.name} ${KIND_LABEL[i.kind] ?? i.kind}`).join(" · ");
  return list.length > max ? `${head} 외 ${list.length - max}곳` : head;
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
    const { data: issueData, error: iErr } = await supabase.rpc("crawler_watch_issues");
    if (iErr) return json({ error: iErr.message }, 500);
    const issues = (issueData ?? []) as Issue[];

    const { data: openData, error: oErr } = await supabase.from("crawler_alerts")
      .select("id, source_id, kind, last_notified_at").is("closed_at", null);
    if (oErr) return json({ error: oErr.message }, 500);
    const open = (openData ?? []) as Alert[];

    const openByKey = new Map(open.map((a) => [key(a.source_id, a.kind), a]));
    const issueKeys = new Set(issues.map((i) => key(i.source_id, i.kind)));
    const fresh = issues.filter((i) => !openByKey.has(key(i.source_id, i.kind)));
    const continuing = issues.filter((i) => openByKey.has(key(i.source_id, i.kind)));
    const remind = continuing.filter((i) => {
      const a = openByKey.get(key(i.source_id, i.kind))!;
      return !a.last_notified_at || now - Date.parse(a.last_notified_at) >= REMIND_MS;
    });
    const resolved = open.filter((a) => !issueKeys.has(key(a.source_id, a.kind)));

    // 복구 알림에 쓸 이름
    const resolvedNamed: { name: string; kind: string }[] = [];
    if (resolved.length > 0) {
      const { data: srcs } = await supabase.from("sources").select("id, name").in("id", resolved.map((a) => a.source_id));
      const nameById = new Map(((srcs ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
      for (const a of resolved) resolvedNamed.push({ name: nameById.get(a.source_id) ?? "?", kind: a.kind });
    }

    const toNotify = [...fresh, ...remind];
    const report = {
      issues: issues.map((i) => ({ key: i.parser_key, name: i.name, kind: i.kind, detail: i.detail })),
      fresh: fresh.length, remind: remind.length, resolved: resolvedNamed,
    };
    if (dryRun) return json({ dryRun: true, ...report });

    // 관리자 토큰
    const { data: admins } = await supabase.from("ops_admins").select("user_id");
    const adminIds = ((admins ?? []) as { user_id: string }[]).map((a) => a.user_id);
    let tokens: string[] = [];
    if (adminIds.length > 0) {
      const { data: toks } = await supabase.from("push_tokens").select("token").in("user_id", adminIds).eq("is_active", true);
      tokens = ((toks ?? []) as { token: string }[]).map((t) => t.token);
    }
    const canNotify = tokens.length > 0;

    let push = null;
    if (canNotify && (toNotify.length > 0 || resolvedNamed.length > 0)) {
      const title = toNotify.length > 0 ? `크롤러 점검 필요 ${toNotify.length}곳` : `크롤러 복구 ${resolvedNamed.length}곳`;
      const parts: string[] = [];
      if (toNotify.length > 0) parts.push(summarize(toNotify));
      if (resolvedNamed.length > 0) parts.push(toNotify.length > 0 ? `복구 ${resolvedNamed.length}곳` : summarize(resolvedNamed));
      const messages: PushMessage[] = tokens.map((to) => ({
        to, title, body: parts.join(" / "), sound: "default", channelId: "default", data: { type: "ops" },
      }));
      push = await sendPush(supabase, messages);
    }
    const notifiedAt = canNotify && push && push.ok > 0 ? new Date(now).toISOString() : null;

    // 상태 기록
    if (fresh.length > 0) {
      const { error } = await supabase.from("crawler_alerts").insert(fresh.map((i) => ({
        source_id: i.source_id, kind: i.kind, detail: i.detail, last_notified_at: notifiedAt,
      })));
      if (error) console.error(`crawler_alerts insert failed: ${error.message}`);
    }
    for (const i of continuing) {
      const a = openByKey.get(key(i.source_id, i.kind))!;
      const patch: Record<string, unknown> = { detail: i.detail };
      if (notifiedAt && remind.includes(i)) patch.last_notified_at = notifiedAt;
      await supabase.from("crawler_alerts").update(patch).eq("id", a.id);
    }
    if (resolved.length > 0) {
      await supabase.from("crawler_alerts").update({ closed_at: new Date(now).toISOString() })
        .in("id", resolved.map((a) => a.id));
    }

    return json({ ...report, admins: adminIds.length, notified: !!notifiedAt, push });
  } catch (e) {
    console.error(`crawler_watch failed: ${(e as Error).message}`);
    return json({ error: (e as Error).message }, 500);
  }
});
