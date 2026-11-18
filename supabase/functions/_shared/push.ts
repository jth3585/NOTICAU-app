// Expo 푸시 발송 공통 모듈 — keyword_alert_push / daily_digest_push / event_extract 가 함께 쓴다.
//
// sendPush: 100개씩 나눠 보내고(Expo 한도), 응답 티켓을 확인한다.
//   - 티켓이 DeviceNotRegistered 면 그 토큰을 바로 비활성화한다.
//   - 정상 티켓은 push_tickets 에 남겨 두고, 나중에 checkReceipts 가 실제 전달 결과(영수증)를 본다.
//   - 429·5xx 는 잠깐 쉬었다가 두 번까지 다시 보낸다(400 류는 다시 보내도 같으므로 재시도 안 함).
// checkReceipts: 15분~24시간 지난 티켓의 영수증을 받아 DeviceNotRegistered 토큰을 비활성화하고,
//   결과를 확인했거나 24시간이 지난 티켓 행을 지운다. keyword_alert_push 가 매시간 부른다.
//
// Android 는 channelId 가 기기에 없으면 알림이 표시되지 않는다. 앱(lib/push.ts)이 만드는 채널 id 와 맞출 것:
//   keyword / digest / event / default

// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const SEND_URL = "https://exp.host/--/api/v2/push/send";
const RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  channelId?: "keyword" | "digest" | "event" | "default";
  priority?: "default" | "normal" | "high";
};

export type SendResult = {
  messages: number;
  ok: number;
  errors: Record<string, number>; // 오류 종류별 건수(DeviceNotRegistered, HTTP_500 등)
  deactivated: number;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postJson(url: string, body: unknown): Promise<{ status: number; json: any }> {
  let last = { status: 0, json: null as any };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(attempt * 1500);
    try {
      const res = await fetch(url, { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
      const json = await res.json().catch(() => null);
      last = { status: res.status, json };
      if (res.status !== 429 && res.status < 500) return last;
    } catch (e) {
      last = { status: 0, json: { errors: [{ code: "FETCH_FAILED", message: (e as Error).message }] } };
    }
  }
  return last;
}

export async function deactivateTokens(supabase: SupabaseClient, tokens: string[]): Promise<number> {
  const uniq = [...new Set(tokens)];
  let n = 0;
  for (const part of chunk(uniq, 200)) {
    const { data, error } = await supabase.from("push_tokens").update({ is_active: false })
      .in("token", part).eq("is_active", true).select("token");
    if (error) console.error(`push token deactivate failed: ${error.message}`);
    n += (data ?? []).length;
  }
  return n;
}

export async function sendPush(supabase: SupabaseClient, messages: PushMessage[]): Promise<SendResult> {
  const result: SendResult = { messages: messages.length, ok: 0, errors: {}, deactivated: 0 };
  const bump = (k: string, by = 1) => { result.errors[k] = (result.errors[k] ?? 0) + by; };
  const dead: string[] = [];
  const tickets: { id: string; token: string }[] = [];

  for (const part of chunk(messages, 100)) {
    const { status, json } = await postJson(SEND_URL, part);
    const data = Array.isArray(json?.data) ? json.data : null;
    if (status !== 200 || !data) {
      const code = json?.errors?.[0]?.code ?? `HTTP_${status}`;
      console.error(`expo push send failed: ${code} ${json?.errors?.[0]?.message ?? ""}`);
      bump(code, part.length);
      continue;
    }
    data.forEach((t: any, i: number) => {
      const token = part[i]?.to;
      if (t?.status === "ok" && typeof t.id === "string") {
        result.ok++;
        tickets.push({ id: t.id, token });
      } else {
        const code = t?.details?.error ?? "UNKNOWN";
        bump(code);
        if (code === "DeviceNotRegistered" && token) dead.push(token);
      }
    });
  }

  if (tickets.length > 0) {
    for (const part of chunk(tickets, 500)) {
      const { error } = await supabase.from("push_tickets").insert(part);
      if (error) console.error(`push_tickets insert failed: ${error.message}`);
    }
  }
  if (dead.length > 0) result.deactivated = await deactivateTokens(supabase, dead);
  return result;
}

export type ReceiptResult = { checked: number; ok: number; errors: Record<string, number>; deactivated: number; purged: number };

export async function checkReceipts(supabase: SupabaseClient, maxBatches = 3): Promise<ReceiptResult> {
  const result: ReceiptResult = { checked: 0, ok: 0, errors: {}, deactivated: 0, purged: 0 };
  const now = Date.now();
  const readyBefore = new Date(now - 15 * 60 * 1000).toISOString();
  const expiredBefore = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  // Expo 가 이미 지운 영수증(24시간 경과)은 확인할 수 없으니 먼저 정리한다.
  const { count: purged } = await supabase.from("push_tickets").delete({ count: "exact" }).lt("created_at", expiredBefore);
  result.purged = purged ?? 0;

  const dead: string[] = [];
  for (let b = 0; b < maxBatches; b++) {
    const { data: rows, error } = await supabase.from("push_tickets").select("id, token")
      .lt("created_at", readyBefore).order("created_at").limit(1000);
    if (error) { console.error(`push_tickets select failed: ${error.message}`); break; }
    if (!rows || rows.length === 0) break;

    const { status, json } = await postJson(RECEIPTS_URL, { ids: rows.map((r: any) => r.id) });
    const receipts = json?.data;
    if (status !== 200 || !receipts || typeof receipts !== "object") {
      console.error(`expo receipts failed: HTTP ${status}`);
      break;
    }
    const done: string[] = [];
    for (const r of rows as { id: string; token: string }[]) {
      const rec = receipts[r.id];
      if (!rec) continue; // 아직 영수증이 없다 → 다음 시간에 다시 본다(24시간 지나면 위에서 정리)
      done.push(r.id);
      result.checked++;
      if (rec.status === "ok") { result.ok++; continue; }
      const code = rec.details?.error ?? "UNKNOWN";
      result.errors[code] = (result.errors[code] ?? 0) + 1;
      if (code === "DeviceNotRegistered") dead.push(r.token);
    }
    for (const part of chunk(done, 500)) await supabase.from("push_tickets").delete().in("id", part);
    if (rows.length < 1000 || done.length === 0) break;
  }
  if (dead.length > 0) result.deactivated = await deactivateTokens(supabase, dead);
  return result;
}
