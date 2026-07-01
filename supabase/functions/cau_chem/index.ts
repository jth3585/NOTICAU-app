// cau_chem — 화학과(chem.cau.ac.kr) News & Events 크롤러 (JSON API)
//
// 목록+본문: POST /eng/api/board-list.php?board=news-event&pageNo=1&pageSize=N&announce=3&keyword=
//   → 이중 인코딩된 JSON 문자열. JSON.parse 2회 → { response: [ {seq, title(b64), content(b64 HTML),
//     writeAt("YYYY-MM-DD HH:MM:SS"), outLink, articleType} ] }. title/content는 base64(UTF-8).
//   본문이 목록에 함께 오므로 상세 조회 불필요.
//
// 소속: 화학과(chemistry 단독). 인증: Bearer <CRON_SECRET>.

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_chem";
const BASE = "https://chem.cau.ac.kr";
const BOARD = "news-event";
const AUTHOR = "화학과";
const DEFAULT_BACKFILL = "2026-05-01";

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [1_000, 3_000];

const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "X-Requested-With": "XMLHttpRequest",
  "Referer": `${BASE}/eng/board.php?selected=${BOARD}`,
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

// base64(UTF-8) → 문자열
function b64ToUtf8(b64: string): string {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}

async function fetchList(pageSize: number): Promise<any[]> {
  const url = `${BASE}/eng/api/board-list.php?board=${BOARD}&pageNo=1&pageSize=${pageSize}&announce=3&keyword=`;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers: REQUEST_HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let j: any = await res.json();
      if (typeof j === "string") j = JSON.parse(j); // 이중 인코딩 대응
      const arr = Array.isArray(j?.response) ? j.response : [];
      return arr;
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

function parseContent(html: string) {
  const $ = load(`<div id="c">${html}</div>`);
  const cont = $("#c");
  const bodyText = cont.text().replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const images: string[] = [];
  cont.find("img").each((_, el) => {
    let src = $(el).attr("src");
    if (!src || src.startsWith("data:")) return;
    if (src.startsWith("//")) src = "https:" + src;
    else if (!/^https?:\/\//.test(src)) src = BASE + (src.startsWith("/") ? src : "/" + src);
    images.push(src);
  });
  return { bodyText, images };
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const auth = req.headers.get("Authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let pageSize = 50;
  let backfillFrom = DEFAULT_BACKFILL;
  try {
    const body = await req.json();
    if (body && Number.isInteger(body.pageSize) && body.pageSize > 0) pageSize = Math.min(body.pageSize, 300);
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
    const items = await fetchList(pageSize);
    stats.listed = items.length;

    for (const it of items) {
      const seq = String(it.seq ?? "");
      const title = b64ToUtf8(it.title ?? "").replace(/\s+/g, " ").trim();
      const date = String(it.writeAt ?? "").slice(0, 10);
      if (!seq || !title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { stats.fetchFailed++; continue; }
      if (date < backfillFrom) { stats.skippedOld++; continue; }

      const postedAt = `${date}T00:00:00+09:00`;
      const url = `${BASE}/eng/board.php?selected=${BOARD}&seq=${seq}`;
      try {
        const contentHash = await sha256Hex(`${title}|${SOURCE_PARSER_KEY}/${seq}|${postedAt}`);
        const { data: existing } = await supabase
          .from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
        if (existing) { stats.skippedDup++; continue; }

        const { bodyText, images } = parseContent(b64ToUtf8(it.content ?? ""));
        const outLink = typeof it.outLink === "string" && /^https?:\/\//.test(it.outLink) ? it.outLink : null;

        const { error: insErr } = await supabase.from("notices").insert({
          source_id: sourceId,
          source_category: null,
          title,
          body_text: bodyText,
          body_image_urls: images,
          attachment_urls: outLink ? [outLink] : [],
          source_url: outLink ?? url,
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
        console.error(`item ${seq}: ${(e as Error).message}`);
        stats.fetchFailed++;
      }
      await sleep(200);
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
