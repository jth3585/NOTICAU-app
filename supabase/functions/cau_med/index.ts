// cau_med — 의과대학(med.cau.ac.kr) 공지 크롤러 (표준프레임워크 board, 세션 쿠키 필요)
//
// ※ list.do는 첫 요청에서 JSESSIONID 쿠키를 발급받아 재요청해야 목록이 렌더된다.
// 목록: GET .../basicboard/list.do?menuid=..&boardtypeid=3&pagesize=N → a[href*="view.do?..boardid={id}"]
// 상세: GET .../basicboard/view.do?..&boardid={id} → 제목 .tit, 날짜 .view_detail, 본문 .view_con,
//        첨부 .view_file a[href*="fileDownload.do"]
//
// 소속: 의과대학(medicine 단과대). 인증: Bearer <CRON_SECRET>.

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_med";
const BASE = "https://med.cau.ac.kr";
const MENU_ID = "001002001001";
const BOARD_TYPE = "3";
const LIST_PATH = "/site/program/board/basicboard/list.do";
const VIEW_PATH = "/site/program/board/basicboard/view.do";
const AUTHOR = "의과대학";
const DEFAULT_BACKFILL = "2026-05-01";

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [1_000, 3_000];
const POLITE_DELAY_MS = 300;

const BASE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "Referer": `${BASE}${LIST_PATH}`,
};

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

function parseDate(raw: string): string | null {
  const m = (raw || "").match(/(\d{4})[.\-](\d{2})[.\-](\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

let cookie = "";

async function fetchHtml(url: string): Promise<string> {
  await sleep(POLITE_DELAY_MS);
  const headers: Record<string, string> = { ...BASE_HEADERS };
  if (cookie) headers["Cookie"] = cookie;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      // 세션 쿠키 갱신(JSESSIONID)
      const sc = res.headers.get("set-cookie");
      if (sc) {
        const jid = sc.match(/JSESSIONID=[^;]+/);
        if (jid) cookie = jid[0];
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        const backoff = RETRY_BACKOFF_MS[attempt] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
        console.warn(`[${SOURCE_PARSER_KEY}] fetch 실패 (${(err as Error).name}) → ${backoff}ms 후 재시도 ${attempt + 1}/${MAX_RETRIES}`);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function listUrl(pageSize: number): string {
  return `${BASE}${LIST_PATH}?menuid=${MENU_ID}&boardtypeid=${BOARD_TYPE}&pagesize=${pageSize}&currentpage=1`;
}
function viewUrl(boardid: string): string {
  return `${BASE}${VIEW_PATH}?menuid=${MENU_ID}&boardtypeid=${BOARD_TYPE}&boardid=${boardid}`;
}

function parseBoardIds(html: string): string[] {
  const $ = load(html);
  const ids: string[] = [];
  const seen = new Set<string>();
  $("a[href*='view.do'][href*='boardid=']").each((_, a) => {
    const m = ($(a).attr("href") ?? "").match(/boardid=(\d+)/);
    if (m && !seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
  });
  return ids;
}

async function fetchDetail(boardid: string) {
  const html = await fetchHtml(viewUrl(boardid));
  const $ = load(html);
  const title = $(".tit").first().text().replace(/\s+/g, " ").trim();
  const date = parseDate($(".view_detail").first().text());
  const cont = $(".view_con").first();

  let bodyText = cont.text().replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const images: string[] = [];
  cont.find("img").each((_, el) => {
    let src = $(el).attr("src");
    if (!src || src.startsWith("data:")) return;
    if (src.startsWith("//")) src = "https:" + src;
    else if (!/^https?:\/\//.test(src)) src = BASE + (src.startsWith("/") ? src : "/" + src);
    images.push(src);
  });

  const attachments: string[] = [];
  $("a[href*='fileDownload.do'], .view_file a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href || href === "#" || href.startsWith("javascript")) return;
    const full = /^https?:\/\//.test(href) ? href : BASE + (href.startsWith("/") ? href : "/" + href);
    if (!attachments.includes(full)) attachments.push(full);
  });

  return { title, date, bodyText, images, attachments };
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const auth = req.headers.get("Authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let pageSize = 30;
  let backfillFrom = DEFAULT_BACKFILL;
  try {
    const body = await req.json();
    if (body && Number.isInteger(body.pageSize) && body.pageSize > 0) pageSize = Math.min(body.pageSize, 200);
    if (body && typeof body.backfillFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.backfillFrom)) backfillFrom = body.backfillFrom;
  } catch { /* cron 빈 body */ }

  const { data: source, error: sErr } = await supabase
    .from("sources").select("id").eq("parser_key", SOURCE_PARSER_KEY).single();
  if (sErr || !source) {
    return new Response(JSON.stringify({ error: `source not found: ${SOURCE_PARSER_KEY}` }), { status: 500 });
  }
  const sourceId = source.id;

  const stats = { listed: 0, skippedOld: 0, skippedDup: 0, insertedNotices: 0, fetchFailed: 0 };

  try {
    // 1) 쿠키 발급용 첫 요청 → 2) 쿠키 붙여 실제 목록
    await fetchHtml(listUrl(pageSize));
    const html = await fetchHtml(listUrl(pageSize));
    const ids = parseBoardIds(html);
    stats.listed = ids.length;

    for (const boardid of ids) {
      const url = viewUrl(boardid);
      try {
        // 상세 조회 전, 이미 저장된 boardid면 스킵(cron 효율).
        const { data: existing } = await supabase
          .from("notices").select("id").eq("source_id", sourceId).eq("source_url", url).maybeSingle();
        if (existing) { stats.skippedDup++; continue; }

        const detail = await fetchDetail(boardid);
        if (!detail.title || !detail.date) { stats.fetchFailed++; continue; }
        if (detail.date < backfillFrom) { stats.skippedOld++; continue; }

        const postedAt = `${detail.date}T00:00:00+09:00`;
        const contentHash = await sha256Hex(`${detail.title}|${SOURCE_PARSER_KEY}/${boardid}|${postedAt}`);

        const { error: insErr } = await supabase.from("notices").insert({
          source_id: sourceId,
          source_category: null,
          title: detail.title,
          body_text: detail.bodyText,
          body_image_urls: detail.images,
          attachment_urls: detail.attachments,
          source_url: url,
          author: AUTHOR,
          posted_at: postedAt,
          is_pinned: false,
          content_hash: contentHash,
        });
        if (insErr) {
          if (insErr.code === "23505") { stats.skippedDup++; continue; }
          throw insErr;
        }
        stats.insertedNotices++;
      } catch (e) {
        console.error(`item ${boardid}: ${(e as Error).message}`);
        stats.fetchFailed++;
      }
      await sleep(400);
    }

    await supabase.from("crawler_health").upsert({
      source_id: sourceId,
      last_success_at: new Date().toISOString(),
      last_attempt_at: new Date().toISOString(),
      failure_count: 0,
      last_error: null,
      is_healthy: true,
    });
  } catch (e) {
    await supabase.from("crawler_health").upsert({
      source_id: sourceId,
      last_attempt_at: new Date().toISOString(),
      last_error: String(e).slice(0, 500),
    });
    return new Response(JSON.stringify({ error: String(e), stats }), { status: 500 });
  }

  return new Response(JSON.stringify(stats), { headers: { "Content-Type": "application/json" } });
});
