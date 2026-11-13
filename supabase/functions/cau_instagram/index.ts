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
//
// 이미지: IG CDN URL(media_url)은 서명값 oe= 시각(대략 2~4일 뒤)에 만료된다 → 수집 즉시 Storage
//   'crawled-images/ig/<parser_key>/<shortcode>_<i>' 로 옮겨 그 공개 URL을 body_image_urls 에 저장한다.
//   옮기다 실패한 URL은 CDN URL 그대로 두고, 매 crawl 끝에 rehostPending 이 만료 전까지 다시 시도한다.
//   4) rehost: body {"rehost":true,"limit":N} → 밀린 이미지만 옮김(수동 백필용).
//   5) purgeImages: body {"purgeImages":true} → 게시 IMG_KEEP_DAYS 지난 글의 이미지를 Storage 에서 지우고
//      body_image_urls 를 비운다(무료 Storage 1GB 보호). 누군가 북마크한 글은 남긴다. 매일 cron(cau_instagram_purge).
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
const META_APP_ID = "2500760047081878"; // NOTICAU notice 앱 — debug_token 용 앱 토큰(APP_ID|META_APP_SECRET)
const DEFAULT_BATCH = 10; // crawl 1회당 처리 계정 수(오래 전에 크롤한 순). 계정당 ~5s, 함수 wall clock 한도 150s.

// 이미지 재호스팅
const IMG_BUCKET = "crawled-images"; // cau_dorm 과 같은 공개 버킷
const IMG_PUBLIC_MARK = `/storage/v1/object/public/${IMG_BUCKET}/`;
const IMG_MAX_BYTES = 8_000_000;
const IMG_FETCH_TIMEOUT_MS = 15_000;
// 보관 기간. 실측 ~200KB/장, 하루 80~90장(2026-11 선거철) ≈ 17MB/일 → 30일이면 ~500MB(무료 1GB 안).
// 행사 탭은 최근 60일 글까지 보지만, 한 달 넘게 지난 글의 이미지는 거의 안 열린다.
const IMG_KEEP_DAYS = 30;
const PENDING_SWEEP_LIMIT = 5; // crawl 끝에 함께 처리할 '밀린 이미지' 공지 수
const SWEEP_TIME_BUDGET_MS = 90_000; // crawl 이 이 시간 안에 끝났을 때만 sweep(wall clock 150s 보호)

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

// 조회 주체: META_APP_SECRET 이 있으면 앱 토큰, 없으면 토큰 자신.
// (시스템 사용자 토큰은 앱 개발자가 아니라 자기 자신으로는 debug_token 이 code=100 으로 거절됨)
// 앱 토큰이 거절되면(시크릿 값 오류 → code=190 signature) 토큰 자신으로 재시도하고 appSecretError 를 남긴다.
let appSecretError: string | null = null;
async function debugToken(token: string): Promise<TokenInfo> {
  const inspect = async (inspector: string): Promise<TokenInfo> => {
    try {
      const url = `${GRAPH_BASE}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(inspector)}`;
      const j = await graphFetch(url);
      const d = j?.data ?? {};
      return { type: d.type, is_valid: d.is_valid, expires_at: d.expires_at, data_access_expires_at: d.data_access_expires_at };
    } catch (e) {
      return { error: String((e as Error).message).slice(0, 200) };
    }
  };
  const appSecret = Deno.env.get("META_APP_SECRET")?.trim();
  if (appSecret) {
    const r = await inspect(`${META_APP_ID}|${appSecret}`);
    if (!(r.error && /code=190\b/.test(r.error))) return r;
    appSecretError = `META_APP_SECRET 로 만든 앱 토큰 거절됨(${r.error}) — 시크릿 값 확인 필요`;
  }
  return inspect(token);
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

// 후보 토큰(vault → env 순)을 차례로 시도해 '만료 없는(expires_at=never)' 토큰을 확보한다.
// 단기 사용자 토큰(1~2h)에서 만든 페이지 토큰은 같이 만료되므로 durable 이 아니다 → 다음 후보로.
// (2026-11-12 실측: 대시보드에 단기 토큰이 들어가 페이지 토큰도 1시간 뒤 만료될 뻔함 → env 장기 토큰으로 복구)
async function maintainToken(candidates: { token: string; source: string }[], igUserId: string, pageId: string) {
  appSecretError = null; // 웜 인스턴스에서 이전 요청 값이 남지 않게
  let last: Record<string, unknown> = { ok: false, error: "no token candidates" };
  const tried: unknown[] = [];
  for (const c of candidates) {
    const r = await maintainOne(c.token, c.source, igUserId, pageId);
    tried.push({ source: c.source, action: r.action, ok: r.ok, durable: r.durable, error: r.error ?? null });
    last = r;
    if (r.ok === null) break;        // 레이트리밋: 판단 불가, 다음 점검으로
    if (r.ok && r.durable !== false) break; // 만료 없는 토큰 확보(또는 조회 불가지만 동작 확인 → 유지)
  }
  last = { ...last, tried };
  if (appSecretError) last.app_secret_error = appSecretError;
  if (last.ok && last.durable === false) last.warning = `저장된 토큰이 만료됨(${(last.after as any)?.expires_at ?? (last.before as any)?.expires_at}) — 장기 토큰 필요`;
  await saveStatus(last);
  return last;
}

async function maintainOne(token: string, source: string, igUserId: string, pageId: string): Promise<Record<string, any>> {
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
    return status;
  }
  // 조회 권한 없음(code=100: 시스템 사용자 토큰을 앱 토큰 없이 조회) → 실제 동작으로 판단.
  // 동작하면 유지(덮어쓰지 않음), 만료 정보는 META_APP_SECRET 설정 후 확인 가능.
  if (before.error && /code=100\b/.test(before.error)) {
    const err = await probe(igUserId, token);
    if (!err) {
      status.action = "kept (inspect denied, probe ok)";
      status.ok = true;
      status.durable = null;
      status.warning = "토큰 만료 정보 조회 불가 — META_APP_SECRET 시크릿을 설정하면 확인됨";
      return status;
    }
  }
  if (before.error || before.is_valid === false) {
    status.action = "invalid token";
    status.ok = false;
    status.error = before.error ?? "is_valid=false";
    return status;
  }

  // 페이지 토큰 또는 시스템 사용자 토큰이면 동작만 확인(만료 없음일 때만 durable)
  if (before.type === "PAGE" || before.type === "SYSTEM_USER") {
    const err = await probe(igUserId, token);
    status.action = `none(${before.type.toLowerCase()} token)`;
    status.ok = !err;
    status.durable = !err && before.expires_at === 0;
    if (err) status.error = err;
    const warn = dataAccessWarning(before);
    if (warn) status.warning = warn;
    if (source === "env" && status.durable) { await supabase.rpc("set_instagram_token", { p_token: token, p_note: "page token (from env)" }); status.action = "copied env→vault"; }
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
    status.after = { ...after, expires_at: tsIso(after.expires_at), data_access_expires_at: tsIso(after.data_access_expires_at) };
    status.durable = after.expires_at === 0;
    status.ok = true;
    // 만료되는 페이지 토큰은, 현재 vault 토큰이 이미 그보다 나쁠 때(=이 후보가 vault 자신)만 저장
    if (status.durable || source === "vault") {
      const { error: setErr } = await supabase.rpc("set_instagram_token", { p_token: pageToken, p_note: `page token ${pageId} (${source})` });
      if (setErr) throw new Error(`vault 저장 실패: ${setErr.message}`);
      status.action = `exchanged user→page token (${source})`;
    } else {
      status.action = `skipped: ${source} page token not durable`;
    }
    const warn = dataAccessWarning(after);
    if (warn) status.warning = warn;
  } catch (e) {
    status.action = "exchange failed";
    status.ok = false;
    status.error = String((e as Error).message).slice(0, 300);
  }
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

// ── 이미지 재호스팅 ─────────────────────────────────────────────────────────────

const isRehosted = (u: string) => u.includes(IMG_PUBLIC_MARK);

// IG CDN URL의 서명 만료 시각(oe=16진 초). 없거나 못 읽으면 null.
function cdnExpiry(u: string): number | null {
  const m = u.match(/[?&]oe=([0-9A-Fa-f]+)/);
  if (!m) return null;
  const s = parseInt(m[1], 16);
  return Number.isFinite(s) ? s * 1000 : null;
}
const cdnExpired = (u: string) => {
  const t = cdnExpiry(u);
  return t !== null && t < Date.now();
};

// 게시물 키: permalink 의 shortcode(/p/XXX/, /reel/XXX/). 못 뽑으면 fallback(미디어 id 등).
function postKey(permalink: string | null | undefined, fallback: string): string {
  const m = (permalink ?? "").match(/instagram\.com\/(?:[^/?#]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : fallback.replace(/[^A-Za-z0-9_-]/g, "_");
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic" };

async function rehostOne(url: string, basePath: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(IMG_FETCH_TIMEOUT_MS) });
    if (!res.ok) { await res.body?.cancel(); return null; }
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!type.startsWith("image/")) { await res.body?.cancel(); return null; }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > IMG_MAX_BYTES) return null;
    const path = `${basePath}.${EXT[type] ?? "jpg"}`;
    const { error } = await supabase.storage.from(IMG_BUCKET)
      .upload(path, bytes, { contentType: type, upsert: true, cacheControl: "31536000" });
    if (error) { console.error(`rehost upload ${path}: ${error.message}`); return null; }
    return supabase.storage.from(IMG_BUCKET).getPublicUrl(path).data.publicUrl;
  } catch (e) {
    console.error(`rehost fetch: ${(e as Error).message}`);
    return null;
  }
}

// 이미지 목록을 Storage 로 옮긴다. 옮긴 건 Storage URL, 실패한 건 원래 URL(만료됐으면 제외).
async function rehostImages(parserKey: string, key: string, urls: string[]): Promise<{ urls: string[]; failed: number; dropped: number }> {
  let failed = 0;
  let dropped = 0;
  const out = await Promise.all(urls.map(async (u, i) => {
    if (isRehosted(u)) return u;
    if (cdnExpired(u)) { dropped++; return null; } // 서명 만료 → 다시 받을 수 없음
    const r = await rehostOne(u, `ig/${parserKey}/${key}_${i}`);
    if (!r) failed++;
    return r ?? u;
  }));
  return { urls: out.filter((u): u is string => !!u), failed, dropped };
}

// 아직 CDN URL이 남은 인스타 공지(보관 기간 안)를 최신순으로 limit 건 옮긴다.
async function rehostPending(limit: number) {
  const cutoff = new Date(Date.now() - IMG_KEEP_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase.from("notices")
    .select("id, source_url, body_image_urls, sources!inner(parser_key)")
    .eq("channel", "instagram")
    .gt("posted_at", cutoff)
    .order("posted_at", { ascending: false })
    .limit(500);
  if (error) return { error: error.message };
  const pending = (data ?? []).filter((n: any) => (n.body_image_urls ?? []).some((u: string) => !isRehosted(u)));
  const res = { pending: pending.length, notices: 0, images: 0, failed: 0, dropped: 0 };
  for (const n of pending.slice(0, limit) as any[]) {
    const parserKey = (Array.isArray(n.sources) ? n.sources[0] : n.sources)?.parser_key ?? "unknown";
    const before: string[] = n.body_image_urls ?? [];
    const r = await rehostImages(parserKey, postKey(n.source_url, n.id), before);
    res.failed += r.failed;
    res.dropped += r.dropped;
    res.images += r.urls.filter(isRehosted).length - before.filter(isRehosted).length;
    if (r.urls.join("\n") !== before.join("\n")) {
      const { error: upErr } = await supabase.from("notices").update({ body_image_urls: r.urls }).eq("id", n.id);
      if (upErr) { res.failed++; continue; }
      res.notices++;
    }
  }
  return res;
}

// 보관 기간이 지난 글의 이미지를 Storage 에서 지운다(북마크된 글은 유지).
async function purgeOldImages() {
  const cutoff = new Date(Date.now() - IMG_KEEP_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase.from("notices")
    .select("id, body_image_urls")
    .eq("channel", "instagram")
    .lt("posted_at", cutoff)
    .not("body_image_urls", "eq", "{}")
    .order("posted_at", { ascending: true })
    .limit(200);
  if (error) return { error: error.message };
  const rows = (data ?? []).filter((n: any) => (n.body_image_urls ?? []).length > 0) as { id: string; body_image_urls: string[] }[];
  if (rows.length === 0) return { notices: 0, removed: 0, keptBookmarked: 0 };
  const { data: bm } = await supabase.from("user_feed_state").select("notice_id")
    .in("notice_id", rows.map((r) => r.id)).not("bookmarked_at", "is", null);
  const keep = new Set((bm ?? []).map((r: { notice_id: string }) => r.notice_id));
  const res = { notices: 0, removed: 0, keptBookmarked: 0, failed: 0 };
  for (const n of rows) {
    if (keep.has(n.id)) { res.keptBookmarked++; continue; }
    const paths = n.body_image_urls.filter(isRehosted).map((u) => decodeURIComponent(u.split(IMG_PUBLIC_MARK)[1].split("?")[0]));
    if (paths.length > 0) {
      const { error: rmErr } = await supabase.storage.from(IMG_BUCKET).remove(paths);
      if (rmErr) { res.failed++; continue; }
      res.removed += paths.length;
    }
    const { error: upErr } = await supabase.from("notices").update({ body_image_urls: [] }).eq("id", n.id);
    if (upErr) { res.failed++; continue; }
    res.notices++;
  }
  return res;
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
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

  // 이미지 전용 모드(Graph API 호출 없음)
  if (body?.rehost) {
    const n = Number.isInteger(body?.limit) && body.limit > 0 ? Math.min(body.limit, 60) : 20;
    return new Response(JSON.stringify({ mode: "rehost", ...(await rehostPending(n)) }, null, 2),
      { headers: { "Content-Type": "application/json" } });
  }
  if (body?.purgeImages) {
    return new Response(JSON.stringify({ mode: "purgeImages", keepDays: IMG_KEEP_DAYS, ...(await purgeOldImages()) }, null, 2),
      { headers: { "Content-Type": "application/json" } });
  }

  if (!token || !igUserId) {
    return new Response(
      JSON.stringify({ error: "INSTAGRAM_TOKEN / INSTAGRAM_IG_USER_ID 미설정 (body.igUserId 로도 지정 가능)" }),
      { status: 500 },
    );
  }

  // ── 0) TOKEN MAINT: 토큰 상태 점검 + 사용자 토큰이면 '만료 없는 페이지 토큰'으로 교체 ─────
  if (body?.tokenMaint) {
    const pageId = typeof body?.pageId === "string" ? body.pageId : DEFAULT_PAGE_ID;
    const candidates: { token: string; source: string }[] = [];
    if (typeof vaultToken === "string" && vaultToken) candidates.push({ token: vaultToken, source: "vault" });
    const envToken = Deno.env.get("INSTAGRAM_TOKEN");
    if (envToken && envToken !== vaultToken) candidates.push({ token: envToken, source: "env" });
    const result = await maintainToken(candidates, igUserId, pageId);
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

          // 이미지는 Storage 로 옮겨 저장(CDN URL은 며칠 뒤 만료). 실패분은 CDN URL로 두고 rehostPending 이 재시도.
          const rh = await rehostImages(src.parser_key, postKey(m.permalink, m.id), collectImages(m));
          (acc as any).imgFailed = ((acc as any).imgFailed ?? 0) + rh.failed;
          const { error: insErr } = await supabase.from("notices").insert({
            source_id: src.id,
            source_category: null,
            title,
            body_text: (m.caption ?? "").trim(),
            body_image_urls: rh.urls,
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
  // 시간 여유가 있으면 밀린 이미지(업로드 실패분)를 만료 전에 조금씩 옮긴다.
  if (!onlyKey && Date.now() - startedAt < SWEEP_TIME_BUDGET_MS) {
    (overall as any).rehost = await rehostPending(PENDING_SWEEP_LIMIT);
  }
  return new Response(JSON.stringify(overall, null, 2), { headers: { "Content-Type": "application/json" } });
});
