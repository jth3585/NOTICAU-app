// ig_oauth — Instagram(Graph API) 토큰 원클릭 재동의.
//
// Meta는 마지막 동의 후 90일이 지나면 데이터 접근을 끊는다(data access expiration).
// 갱신은 '사용자 재동의'로만 가능 → 이 함수가 그 과정을 링크 한 번으로 줄인다.
//
//   1) GET /functions/v1/ig_oauth            → FB 로그인/재동의 화면으로 리다이렉트(auth_type=reauthorize)
//   2) GET /functions/v1/ig_oauth?code&state → code→단기 사용자 토큰→장기 토큰→Noticau 페이지 토큰(만료 없음)
//                                              → business_discovery 검증 → vault(instagram_token) 저장
//
// 필요한 설정(최초 1회):
//   - Supabase secret META_APP_SECRET (Meta 앱 > 설정 > 기본 설정 > 앱 시크릿 코드)
//   - Meta 앱 Facebook 로그인 설정의 '유효한 OAuth 리디렉션 URI'에 REDIRECT_URI 추가
// 배포: --no-verify-jwt (브라우저에서 바로 여는 링크라 JWT 없음). state는 CRON_SECRET HMAC으로 위조 방지.
// 페이지 관리자가 아닌 사람이 동의해도 페이지 토큰을 못 받아 저장 단계에서 실패하므로 기존 토큰은 안전.

import { createClient } from "jsr:@supabase/supabase-js@2";

const GRAPH_VERSION = "v23.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const APP_ID = "2500760047081878"; // Meta 앱 "NOTICAU notice"
const PAGE_ID = "1444376652096085"; // Noticau FB 페이지(noti_cau IG 연결)
const IG_USER_ID = "17841416764986976"; // noti_cau
const PROBE_HANDLE = "cau.gyul";
const SCOPES = "instagram_basic,instagram_manage_insights,pages_read_engagement,pages_show_list";
const REDIRECT_URI = "https://ntepavohsldelxaiubip.supabase.co/functions/v1/ig_oauth";
const STATE_TTL_MS = 15 * 60 * 1000;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// supabase.co 기본 도메인은 HTML을 text/plain 으로 내려보내므로 평문 응답.
const text = (msg: string, status = 200) =>
  new Response(msg, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(Deno.env.get("CRON_SECRET") ?? ""),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function makeState(): Promise<string> {
  const ts = Date.now().toString();
  return `${ts}.${(await hmac(ts)).slice(0, 32)}`;
}

async function checkState(state: string | null): Promise<boolean> {
  if (!state) return false;
  const [ts, sig] = state.split(".");
  if (!ts || !sig || Date.now() - Number(ts) > STATE_TTL_MS) return false;
  return (await hmac(ts)).slice(0, 32) === sig;
}

async function graph(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j?.error) throw new Error(`Graph ${res.status} code=${j?.error?.code ?? "?"} ${j?.error?.message ?? ""}`.trim());
  return j;
}

const tsIso = (s?: number) => (s && s > 0 ? new Date(s * 1000).toISOString() : s === 0 ? "never" : null);

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const appSecret = Deno.env.get("META_APP_SECRET")?.trim();
  if (!appSecret) return text("설정 필요: Supabase secret META_APP_SECRET 이 없습니다.", 500);

  // 1) 시작: FB 재동의 화면으로
  if (!code) {
    if (url.searchParams.get("error")) return text(`취소/오류: ${url.searchParams.get("error_description") ?? url.searchParams.get("error")}`, 400);
    const dialog = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
    dialog.searchParams.set("client_id", APP_ID);
    dialog.searchParams.set("redirect_uri", REDIRECT_URI);
    dialog.searchParams.set("scope", SCOPES);
    dialog.searchParams.set("auth_type", "reauthorize");
    dialog.searchParams.set("response_type", "code");
    dialog.searchParams.set("state", await makeState());
    return Response.redirect(dialog.toString(), 302);
  }

  // 2) 콜백
  if (!(await checkState(url.searchParams.get("state")))) return text("state 검증 실패(만료되었거나 위조). 링크를 다시 열어주세요.", 400);

  try {
    const shortTok = await graph(
      `${GRAPH_BASE}/oauth/access_token?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`,
    );
    const longTok = await graph(
      `${GRAPH_BASE}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}` +
      `&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(shortTok.access_token)}`,
    );
    const page = await graph(`${GRAPH_BASE}/${PAGE_ID}?fields=access_token&access_token=${encodeURIComponent(longTok.access_token)}`);
    const pageToken: string | undefined = page?.access_token;
    if (!pageToken) throw new Error("페이지 토큰을 받지 못함 — Noticau 페이지를 선택했는지/페이지 관리자인지 확인");

    const probe = await graph(
      `${GRAPH_BASE}/${IG_USER_ID}?fields=${encodeURIComponent(`business_discovery.username(${PROBE_HANDLE}){followers_count}`)}` +
      `&access_token=${encodeURIComponent(pageToken)}`,
    );
    if (!probe?.business_discovery) throw new Error("business_discovery 검증 실패");

    const dbg = await graph(`${GRAPH_BASE}/debug_token?input_token=${encodeURIComponent(pageToken)}&access_token=${APP_ID}|${encodeURIComponent(appSecret)}`);
    const d = dbg?.data ?? {};

    const { error: setErr } = await supabase.rpc("set_instagram_token", { p_token: pageToken, p_note: `page token via ig_oauth ${new Date().toISOString()}` });
    if (setErr) throw new Error(`vault 저장 실패: ${setErr.message}`);

    const status = {
      checked_at: new Date().toISOString(),
      ok: true,
      action: "reauthorized via ig_oauth",
      after: { type: d.type, is_valid: d.is_valid, expires_at: tsIso(d.expires_at), data_access_expires_at: tsIso(d.data_access_expires_at) },
    };
    await supabase.from("integration_status").upsert({ key: "instagram_token", value: status, updated_at: new Date().toISOString() });

    return text(
      `완료! 인스타 수집 토큰이 갱신되었습니다.\n\n` +
      `토큰 종류: ${d.type ?? "?"} / 만료: ${tsIso(d.expires_at) ?? "?"}\n` +
      `다음 재동의 기한(데이터 접근 만료): ${tsIso(d.data_access_expires_at) ?? "?"}\n\n이 창은 닫아도 됩니다.`,
    );
  } catch (e) {
    const msg = String((e as Error).message).slice(0, 300);
    await supabase.from("integration_status").upsert({
      key: "instagram_token_reauth_error",
      value: { at: new Date().toISOString(), error: msg },
      updated_at: new Date().toISOString(),
    });
    return text(`실패: ${msg}\n\n기존 토큰은 그대로 유지됩니다.`, 500);
  }
});
