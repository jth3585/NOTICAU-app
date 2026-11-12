// cau_instagram — 학생회/학교 Instagram 공지 크롤러 (Instagram Graph API · Business Discovery)
//
// 공식 경로: Facebook Login 기반 Instagram Graph API의 business_discovery.
//   조회용(노티카우) IG '프로페셔널' 계정이 FB 페이지에 연결돼 있어야 하고,
//   대상 계정도 '프로페셔널(비즈니스/크리에이터)'이어야만 읽힌다(개인/연령제한 계정은 안 보임).
//   GET /{IG_USER_ID}?fields=business_discovery.username(TARGET){...media...}
//
// 소스 구조: 계정 1개 = sources 1행.
//   parser_key = 'cau_ig_<slug>', list_url = 'https://www.instagram.com/<handle>/' (여기서 핸들 추출).
//   scope_type/owner_unit/campus 로 소속 스코프 지정(총학=university·owner_unit null·campus both → 전교 노출).
//   함수는 parser_key LIKE 'cau_ig_%' 인 활성 소스를 전부 순회한다.
//
// 모드:
//   1) verify(드라이런): body {"verify":true, "accounts":["cau.ullim", ...]} → DB 미기록, 계정별 도달성만 반환.
//      (토큰·IG_USER_ID 만 있으면 sources 행 없이도 "어떤 계정이 읽히나"를 즉시 점검)
//   2) crawl(기본): sources(cau_ig_%) 순회 → 최근 게시물을 notices에 적재. llm_classify cron이 자동 분류.
//
// 토큰: vault 'instagram_token'(만료 없는 페이지 토큰, tokenMaint 모드가 관리) 우선, 없으면 env INSTAGRAM_TOKEN.
//   3) tokenMaint: body {"tokenMaint":true} → 토큰 점검, 사용자 토큰이면 페이지 토큰으로 교환해 vault 저장,
//      결과는 integration_status('instagram_token'). 주 1회 cron(cau_instagram_token).
// IG_USER_ID 는 body.igUserId(cron) 또는 env INSTAGRAM_IG_USER_ID.
// 인증: Bearer <CRON_SECRET>.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PREFIX = "cau_ig_";
const GRAPH_VERSION = "v23.0"; // 필요 시 상향(2026-11 기준 v26.0까지 존재). Meta 버전은 ~2년 지원.
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const DEFAULT_BACKFILL = "2026-05-01";

// 계정당 게시물 수. 앱 한도는 호출 수뿐 아니라 CPU/처리시간도 세므로 작게(25→10 실측 후 축소).
// 등록 이후 글만 받고 계정당 ~2h 주기라 10개면 충분, 넘치면 페이지네이션으로 이어 받음.
const MEDIA_PAGE_SIZE = 10;
const LIGHT_CHECK_SIZE = 5; // 1단계 새 글 확인용(permalink,timestamp만)
const MAX_MEDIA_PAGES = 6; // 백필 깊이 상한 (25 * 6 = 150개)
const FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [1_000, 3_000];
const POLITE_DELAY_MS = 400; // 계정 간 간격 (레이트리밋 완화)
const RATE_LIMIT_CODES = [4, 17, 32, 613]; // Graph API 호출 한도 오류 코드
const TOKEN_ERROR_CODES = [190, 102]; // 토큰 만료/무효 → 배치 중단 + integration_status 기록
const DEFAULT_PAGE_ID = "1444376652096085"; // Noticau FB 페이지(noti_cau IG 연결)
const PROBE_HANDLE = "cau.gyul"; // 토큰 검증용 대상(프로페셔널 확인됨)
const DEFAULT_BATCH = 10; // crawl 1회당 처리 계정 수(오래 전에 크롤한 순). 계정당 ~5s, 함수 wall clock 한도 150s.

// business_discovery 로 요청할 media 서브필드. like_count/comments_count 는 권한 이슈 가능성 있어 제외(공지용엔 불필요).
const MEDIA_FIELDS =
  "id,caption,timestamp,permalink,media_type,media_url,children{media_url,media_type}";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// list_url(또는 임의 입력)에서 instagram 핸들 추출. "cau.ullim" 그대로도 허용.
function extractHandle(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const m = s.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  const handle = (m ? m[1] : s).replace(/^@/, "").replace(/\/+$/, "").trim();
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? handle : null;
}

type IgMediaChild = { media_url?: string; media_type?: string };
type IgMedia = {
  id: string;
  caption?: string;
  timestamp: string; // ISO8601, e.g. 2026-10-01T12:34:56+0000
  permalink: string;
  media_type: string; // IMAGE | VIDEO | CAROUSEL_ALBUM
  media_url?: string; // 일부 VIDEO/REELS 는 생략될 수 있음
  children?: { data?: IgMediaChild[] };
};
type BusinessDiscovery = {
  followers_count?: number;
  media_count?: number;
  media?: { data?: IgMedia[]; paging?: { cursors?: { after?: string } } };
};

let lastAppUsage: string | null = null;

async function graphFetch(url: string): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      const usage = res.headers.get("x-app-usage"); // {"call_count":%, "total_cputime":%, "total_time":%} — 앱 한도 대비 사용률
      if (usage) lastAppUsage = usage;
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.error) {
        const e = json?.error ?? {};
        // 일시 오류만 재시도. 레이트리밋(4,17,32,613)은 재시도하면 한도만 더 소진 → 즉시 throw(호출부가 배치 중단).
        const code = e?.code;
        const retryable = res.status >= 500 || [1, 2].includes(code);
        const msg = `Graph ${res.status} code=${code ?? "?"} ${e?.message ?? ""}`.trim();
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(RETRY_BACKOFF_MS[attempt] ?? 3000);
          continue;
        }
        const err: any = new Error(msg);
        err.graphCode = code;
        throw err;
      }
      return json;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES && (err as any)?.name === "TimeoutError") {
        await sleep(RETRY_BACKOFF_MS[attempt] ?? 3000);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function bdUrl(igUserId: string, token: string, handle: string, mediaLimit: number, after?: string): string {
  const mediaArgs = after
    ? `.limit(${mediaLimit}).after(${after})`
    : `.limit(${mediaLimit})`;
  const fields = `business_discovery.username(${handle}){followers_count,media_count,media${mediaArgs}{${MEDIA_FIELDS}}}`;
  return `${GRAPH_BASE}/${igUserId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
}

// 단일 계정 조회(미디어 페이지네이션 포함). verify/crawl 공용.
async function fetchAccount(
  igUserId: string,
  token: string,
  handle: string,
  opts: { backfillFrom?: string; maxPages?: number; pageSize?: number } = {},
): Promise<{ followers?: number; mediaCount?: number; media: IgMedia[] }> {
  const maxPages = opts.maxPages ?? 1;
  const pageSize = opts.pageSize ?? MEDIA_PAGE_SIZE;
  const backfillFrom = opts.backfillFrom;
  const all: IgMedia[] = [];
  let after: string | undefined;
  let followers: number | undefined;
  let mediaCount: number | undefined;

  for (let page = 0; page < maxPages; page++) {
    const json = await graphFetch(bdUrl(igUserId, token, handle, pageSize, after));
    const bd: BusinessDiscovery | undefined = json?.business_discovery;
    if (!bd) throw new Error("no business_discovery in response");
    if (page === 0) {
      followers = bd.followers_count;
      mediaCount = bd.media_count;
    }
    const batch = bd.media?.data ?? [];
    all.push(...batch);

    // 백필 하한 넘어서면 중단
    if (backfillFrom && batch.some((m) => (m.timestamp ?? "").slice(0, 10) < backfillFrom)) break;
    after = bd.media?.paging?.cursors?.after;
    if (!after || batch.length === 0) break;
    await sleep(300);
  }
  return { followers, mediaCount, media: all };
}

// ── 토큰 관리 ────────────────────────────────────────────────────────────────
// 장기(60일) '사용자' 토큰으로 GET /{page_id}?fields=access_token 하면 만료 없는 '페이지' 토큰이 나온다.
// 페이지 토큰으로도 business_discovery 가 동작하므로 이걸 vault에 저장해 쓴다.
// 페이지 토큰이 무효화되는 경우(FB 비번 변경·페이지 권한 상실·앱 권한 해제)는 사람이 새 사용자 토큰을
// set_instagram_token() 으로 넣어야 한다 → integration_status 에 상태/오류를 남겨 감지.
type TokenInfo = { type?: string; is_valid?: boolean; expires_at?: number; data_access_expires_at?: number; error?: string };

async function debugToken(token: string): Promise<TokenInfo> {
  try {
    const url = `${GRAPH_BASE}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`;
    const j = await graphFetch(url);
    const d = j?.data ?? {};
    return { type: d.type, is_valid: d.is_valid, expires_at: d.expires_at, data_access_expires_at: d.data_access_expires_at };
  } catch (e) {
    return { error: String((e as Error).message).slice(0, 200) };
  }
}

async function probe(igUserId: string, token: string): Promise<string | null> {
  try {
    const url = `${GRAPH_BASE}/${igUserId}?fields=${encodeURIComponent(`business_discovery.username(${PROBE_HANDLE}){followers_count}`)}&access_token=${encodeURIComponent(token)}`;
    const j = await graphFetch(url);
    return j?.business_discovery ? null : "no business_discovery";
  } catch (e) {
    return String((e as Error).message).slice(0, 200);
  }
}

const tsIso = (s?: number) => (s && s > 0 ? new Date(s * 1000).toISOString() : s === 0 ? "never" : null);

// 페이지 토큰은 expires_at=never 이지만 data_access_expires_at(마지막 동의 후 90일)은 남는다.
// 21일 안으로 다가오면 경고 → 사람이 Graph Explorer 등에서 앱 재동의 후 새 사용자 토큰을 set_instagram_token().
const DATA_ACCESS_WARN_DAYS = 21;
function dataAccessWarning(info: TokenInfo): string | null {
  const t = info.data_access_expires_at;
  if (!t || t <= 0) return null;
  const days = Math.floor((t * 1000 - Date.now()) / 86_400_000);
  return days <= DATA_ACCESS_WARN_DAYS ? `data access expires in ${days}d (${tsIso(t)}) — 앱 재동의 후 set_instagram_token 필요` : null;
}

async function saveStatus(value: Record<string, unknown>) {
  await supabase.from("integration_status").upsert({ key: "instagram_token", value, updated_at: new Date().toISOString() });
}

async function maintainToken(token: string, source: string, igUserId: string, pageId: string) {
  const before = await debugToken(token);
  const status: Record<string, unknown> = {
    checked_at: new Date().toISOString(),
    source,
    before: { ...before, expires_at: tsIso(before.expires_at), data_access_expires_at: tsIso(before.data_access_expires_at) },
  };

  // 앱 호출 한도에 걸렸으면 판단 불가 → 아무것도 바꾸지 않고 다음 점검으로 미룸
  if (before.error && /code=(4|17|32|613)\b/.test(before.error)) {
    status.action = "skipped (rate limited)";
    status.ok = null;
    await saveStatus(status);
    return status;
  }

  // 페이지 토큰 또는 시스템 사용자 토큰(만료·재동의 없음)이면 동작만 확인
  if (before.type === "PAGE" || before.type === "SYSTEM_USER") {
    const err = await probe(igUserId, token);
    status.action = `none(${before.type.toLowerCase()} token)`;
    status.ok = !err;
    if (err) status.error = err;
    const warn = dataAccessWarning(before);
    if (warn) status.warning = warn;
    if (source === "env" && !err) { await supabase.rpc("set_instagram_token", { p_token: token, p_note: "page token (from env)" }); status.action = "copied env→vault"; }
    await saveStatus(status);
    return status;
  }

  // 사용자 토큰 → 페이지 토큰 교환
  try {
    const j = await graphFetch(`${GRAPH_BASE}/${pageId}?fields=access_token&access_token=${encodeURIComponent(token)}`);
    const pageToken: string | undefined = j?.access_token;
    if (!pageToken) throw new Error("page access_token 없음 (페이지 권한/pages_show_list 확인)");
    const err = await probe(igUserId, pageToken);
    if (err) throw new Error(`page token probe 실패: ${err}`);
    const after = await debugToken(pageToken);
    const { error: setErr } = await supabase.rpc("set_instagram_token", { p_token: pageToken, p_note: `page token ${pageId}` });
    if (setErr) throw new Error(`vault 저장 실패: ${setErr.message}`);
    status.action = "exchanged user→page token";
    const warn = dataAccessWarning(after);
    if (warn) status.warning = warn;
    status.after = { ...after, expires_at: tsIso(after.expires_at), data_access_expires_at: tsIso(after.data_access_expires_at) };
    status.ok = true;
  } catch (e) {
    status.action = "exchange failed";
    status.ok = false;
    status.error = String((e as Error).message).slice(0, 300);
  }
  await saveStatus(status);
  return status;
}

function captionToTitle(caption: string | undefined): string {
  const cap = (caption ?? "").replace(/\r/g, "").trim();
  if (!cap) return "(이미지 게시물)";
  const firstLine = cap.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? cap;
  const clipped = firstLine.length > 80 ? firstLine.slice(0, 79) + "…" : firstLine;
  return clipped || "(이미지 게시물)";
}

function collectImages(m: IgMedia): string[] {
  const urls: string[] = [];
  const push = (u?: string, t?: string) => {
    if (u && (t ?? "").toUpperCase() !== "VIDEO") urls.push(u); // 영상 썸네일/URL 은 OCR 대상 아님 → 제외
  };
  if (m.media_type === "CAROUSEL_ALBUM") {
    for (const c of m.children?.data ?? []) push(c.media_url, c.media_type);
  } else {
    push(m.media_url, m.media_type);
  }
  return urls;
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const auth = req.headers.get("Authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  // 토큰: vault(instagram_token, tokenMaint가 관리) 우선, 없으면 env INSTAGRAM_TOKEN(초기 시드).
  const { data: vaultToken } = await supabase.rpc("get_instagram_token");
  const token: string | undefined = (typeof vaultToken === "string" && vaultToken) || Deno.env.get("INSTAGRAM_TOKEN");
  const tokenSource = typeof vaultToken === "string" && vaultToken ? "vault" : "env";
  let igUserId = Deno.env.get("INSTAGRAM_IG_USER_ID");

  let body: any = {};
  try { body = await req.json(); } catch { /* cron 빈 body */ }
  if (typeof body?.igUserId === "string") igUserId = body.igUserId; // body 로 override 허용
  const backfillFrom = /^\d{4}-\d{2}-\d{2}$/.test(body?.backfillFrom) ? body.backfillFrom : DEFAULT_BACKFILL;

  if (!token || !igUserId) {
    return new Response(
      JSON.stringify({ error: "INSTAGRAM_TOKEN / INSTAGRAM_IG_USER_ID 미설정 (body.igUserId 로도 지정 가능)" }),
      { status: 500 },
    );
  }

  // ── 0) TOKEN MAINT: 토큰 상태 점검 + 사용자 토큰이면 '만료 없는 페이지 토큰'으로 교체 ─────
  if (body?.tokenMaint) {
    const pageId = typeof body?.pageId === "string" ? body.pageId : DEFAULT_PAGE_ID;
    const result = await maintainToken(token, tokenSource, igUserId, pageId);
    return new Response(JSON.stringify(result, null, 2), { headers: { "Content-Type": "application/json" } });
  }

  // ── 1) VERIFY(드라이런): 계정별 도달성만 점검, DB 미기록 ──────────────────────────
  if (body?.verify) {
    const accounts: string[] = Array.isArray(body.accounts) ? body.accounts : [];
    if (accounts.length === 0) {
      return new Response(JSON.stringify({ error: "verify 모드엔 accounts[] 필요" }), { status: 400 });
    }
    const results: any[] = [];
    for (const raw of accounts) {
      const handle = extractHandle(raw);
      if (!handle) { results.push({ input: raw, ok: false, error: "bad handle" }); continue; }
      try {
        const { followers, mediaCount, media } = await fetchAccount(igUserId, token, handle, { maxPages: 1, pageSize: 3 });
        const latest = media[0];
        results.push({
          handle,
          ok: true,
          followers_count: followers ?? null,
          media_count: mediaCount ?? null,
          latest_post_at: latest?.timestamp ?? null,
          latest_title: latest ? captionToTitle(latest.caption) : null,
          sample_size: media.length,
        });
      } catch (e: any) {
        results.push({ handle, ok: false, graphCode: e?.graphCode ?? null, error: String(e?.message ?? e).slice(0, 200) });
        if (RATE_LIMIT_CODES.includes(e?.graphCode)) break; // 한도 소진 → 나머지는 호출 안 함(결과에서 빠짐)
      }
      await sleep(POLITE_DELAY_MS);
    }
    const reachable = results.filter((r) => r.ok).length;
    return new Response(
      JSON.stringify({ mode: "verify", total: accounts.length, reachable, appUsage: lastAppUsage, results }, null, 2),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // ── 2) CRAWL(기본): cau_ig_* 소스 순회 → notices 적재 ────────────────────────────
  // 계정이 많으면 1회 호출로 전부 돌 때 WORKER_RESOURCE_LIMIT(546)에 걸린다(90개 verify에서 실측).
  // → 1회에 '가장 오래 전에 크롤한' 계정 limit개만 처리하고, cron을 촘촘히 돌려 순환시킨다.
  const onlyKey: string | null = typeof body?.parserKey === "string" ? body.parserKey : null;
  const limit = Number.isInteger(body?.limit) && body.limit > 0 ? Math.min(body.limit, 30) : DEFAULT_BATCH;
  let q = supabase.from("sources")
    .select("id, name, parser_key, list_url, is_active, created_at")
    .like("parser_key", `${SOURCE_PREFIX}%`)
    .eq("is_active", true)
    .order("last_crawled_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (onlyKey) q = q.eq("parser_key", onlyKey);
  const { data: sources, error: sErr } = await q;
  if (sErr) return new Response(JSON.stringify({ error: `sources 조회 실패: ${sErr.message}` }), { status: 500 });
  if (!sources || sources.length === 0) {
    return new Response(JSON.stringify({ note: "cau_ig_* 활성 소스 없음 (verify 먼저 돌려 계정 확정 후 sources insert)" }),
      { headers: { "Content-Type": "application/json" } });
  }

  const overall = { accounts: sources.length, listed: 0, skippedOld: 0, skippedDup: 0, inserted: 0, failed: 0, perAccount: [] as any[] };

  for (const src of sources) {
    const handle = extractHandle(src.list_url ?? "");
    const acc = { parser_key: src.parser_key, handle, listed: 0, inserted: 0, skippedOld: 0, skippedDup: 0, failed: 0, error: null as string | null };
    if (!handle) { acc.error = "list_url 에서 핸들 추출 실패"; overall.perAccount.push(acc); continue; }

    // 과거 글은 안 가져온다: 소스 등록 시각 이전 게시물은 skip (앞으로 올라오는 글만 수집).
    const regMs = src.created_at ? Date.parse(src.created_at) : NaN;
    const regDate = Number.isFinite(regMs) ? new Date(regMs).toISOString().slice(0, 10) : backfillFrom;
    const floorDate = regDate > backfillFrom ? regDate : backfillFrom;

    try {
      // 1단계(가벼움): 최근 게시물의 permalink/timestamp만 받아 새 글이 있는지 확인.
      // Meta 앱 한도는 처리시간(total_time)이 먼저 차므로, 새 글 없는 대부분의 회차를 이 호출 하나로 끝낸다.
      const lightJson = await graphFetch(
        `${GRAPH_BASE}/${igUserId}?fields=${encodeURIComponent(`business_discovery.username(${handle}){media.limit(${LIGHT_CHECK_SIZE}){permalink,timestamp}}`)}` +
        `&access_token=${encodeURIComponent(token)}`,
      );
      const recent: { permalink?: string; timestamp?: string }[] = lightJson?.business_discovery?.media?.data ?? [];
      const candidates = recent.filter((m) => {
        const ts = Date.parse((m.timestamp ?? "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
        return m.permalink && (m.timestamp ?? "").slice(0, 10) >= floorDate && !(Number.isFinite(regMs) && Number.isFinite(ts) && ts < regMs);
      });
      let newCount = 0;
      let lastNewIdx = -1; // 고정 게시물이 앞에 올 수 있어 '개수'가 아니라 '위치'로 받을 범위를 정한다
      if (candidates.length > 0) {
        const { data: seen } = await supabase.from("notices").select("source_url")
          .eq("source_id", src.id).in("source_url", candidates.map((m) => m.permalink!));
        const seenSet = new Set((seen ?? []).map((r: { source_url: string }) => r.source_url));
        recent.forEach((m, i) => {
          if (candidates.includes(m) && !seenSet.has(m.permalink!)) { newCount++; lastNewIdx = i; }
        });
      }
      if (newCount === 0) {
        await supabase.from("sources").update({ last_crawled_at: new Date().toISOString() }).eq("id", src.id);
        await supabase.from("crawler_health").upsert({
          source_id: src.id, last_success_at: new Date().toISOString(), last_attempt_at: new Date().toISOString(),
          failure_count: 0, last_error: null, is_healthy: true,
        });
        overall.perAccount.push(acc);
        await sleep(POLITE_DELAY_MS);
        continue;
      }

      // 2단계: 새 글이 있을 때만 본문·이미지까지. 5개 모두 새 글이면 더 있을 수 있으니 기본 크기로 페이지네이션.
      const mayHaveMore = lastNewIdx === recent.length - 1 && recent.length === LIGHT_CHECK_SIZE; // 마지막 칸까지 새 글
      const { media } = await fetchAccount(igUserId, token, handle, {
        backfillFrom: floorDate,
        maxPages: mayHaveMore ? MAX_MEDIA_PAGES : 1,
        pageSize: mayHaveMore ? MEDIA_PAGE_SIZE : lastNewIdx + 1,
      });
      acc.listed = media.length;
      overall.listed += media.length;

      for (const m of media) {
        const date = (m.timestamp ?? "").slice(0, 10);
        const tsMs = Date.parse((m.timestamp ?? "").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
        if (!date || date < backfillFrom || (Number.isFinite(regMs) && Number.isFinite(tsMs) && tsMs < regMs)) {
          acc.skippedOld++; overall.skippedOld++; continue;
        }
        try {
          const title = captionToTitle(m.caption);
          const postedAt = m.timestamp;
          const contentHash = await sha256Hex(`${title}|${src.parser_key}/${m.id}|${postedAt}`);
          const { data: existing } = await supabase
            .from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
          if (existing) { acc.skippedDup++; overall.skippedDup++; continue; }

          const images = collectImages(m);
          const { error: insErr } = await supabase.from("notices").insert({
            source_id: src.id,
            source_category: null,
            title,
            body_text: (m.caption ?? "").trim(),
            body_image_urls: images,
            attachment_urls: [],
            source_url: m.permalink,
            author: src.name,
            posted_at: postedAt,
            is_pinned: false,
            content_hash: contentHash,
          });
          if (insErr) {
            if (insErr.code === "23505") { acc.skippedDup++; overall.skippedDup++; continue; }
            throw insErr;
          }
          acc.inserted++; overall.inserted++;
        } catch (e) {
          console.error(`[${src.parser_key}] media ${m.id}: ${(e as Error).message}`);
          acc.failed++; overall.failed++;
        }
      }

      await supabase.from("sources").update({ last_crawled_at: new Date().toISOString() }).eq("id", src.id);
      await supabase.from("crawler_health").upsert({
        source_id: src.id,
        last_success_at: new Date().toISOString(),
        last_attempt_at: new Date().toISOString(),
        failure_count: 0,
        last_error: null,
        is_healthy: true,
      });
    } catch (e) {
      acc.error = String(e).slice(0, 300);
      overall.failed++;
      if (TOKEN_ERROR_CODES.includes((e as any)?.graphCode)) {
        // 토큰 문제: 모든 계정이 실패할 것이므로 즉시 중단하고 상태 기록(사람이 set_instagram_token 필요).
        overall.perAccount.push(acc);
        (overall as any).tokenError = acc.error;
        await saveStatus({ checked_at: new Date().toISOString(), ok: false, action: "crawl aborted", error: acc.error });
        break;
      }
      if (RATE_LIMIT_CODES.includes((e as any)?.graphCode)) {
        // 앱 호출 한도 소진: 계정 문제가 아니므로 순번 유지하고 이번 배치 중단(다음 cron에서 이어서).
        overall.perAccount.push(acc);
        (overall as any).rateLimited = true;
        break;
      }
      // 계정 자체 실패는 순번을 뒤로 보낸다(안 그러면 죽은 계정이 매 실행 배치 앞자리를 차지).
      await supabase.from("sources").update({ last_crawled_at: new Date().toISOString() }).eq("id", src.id);
      await supabase.from("crawler_health").upsert({
        source_id: src.id,
        last_attempt_at: new Date().toISOString(),
        last_error: acc.error,
      });
    }
    overall.perAccount.push(acc);
    await sleep(POLITE_DELAY_MS);
  }

  (overall as any).appUsage = lastAppUsage;
  return new Response(JSON.stringify(overall, null, 2), { headers: { "Content-Type": "application/json" } });
});
