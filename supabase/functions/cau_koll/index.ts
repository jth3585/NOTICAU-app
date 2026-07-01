// cau_koll — 국어국문학부(koll.cau.ac.kr) 공지/취업정보 크롤러 (mb-board WP 플러그인)
//
// 게시판 2개:
//   u-notice(학부공지, 백필 2026-05-01), infor(공모전&취업정보, 백필 2026-06-01)
// 목록: /board/{board}/?mode=list&board_page=N → a[href*="?vid=N"](title=제목), 행에 날짜
// 상세: /board/{board}/?vid={vid} → .editable-content(본문), .file-download(첨부)
//
// 인증: Bearer <CRON_SECRET>.

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_koll";
const BASE = "https://koll.cau.ac.kr";
// [board, source_category, 기본 백필일]
const BOARDS: [string, string | null, string][] = [
  ["u-notice", null, "2026-05-01"],
  ["infor", "취업/공모", "2026-06-01"],
];

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [1_000, 3_000];
const POLITE_DELAY_MS = 300;

const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "Referer": "https://koll.cau.ac.kr/",
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

function webUrl(board: string, vid: string): string {
  return `${BASE}/board/${board}/?vid=${vid}`;
}

async function fetchHtml(url: string): Promise<string> {
  await sleep(POLITE_DELAY_MS);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        const backoff = RETRY_BACKOFF_MS[attempt] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
        console.warn(`[${SOURCE_PARSER_KEY}] fetch 실패 (${(err as Error).name}) → ${backoff}ms 후 재시도 ${attempt + 1}/${MAX_RETRIES}: ${url}`);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

type ListItem = { vid: string; title: string; date: string };

async function fetchListPage(board: string, page: number): Promise<ListItem[]> {
  const html = await fetchHtml(`${BASE}/board/${board}/?mode=list&board_page=${page}`);
  const $ = load(html);
  const items: ListItem[] = [];
  const seen = new Set<string>();
  const links = $("a[href*='vid=']");
  for (let i = 0; i < links.length; i++) {
    const a = links.eq(i);
    const href = a.attr("href") ?? "";
    const m = href.match(/vid=(\d+)/);
    if (!m || seen.has(m[1])) continue;
    const title = (a.attr("title") || a.text()).replace(/\s+/g, " ").trim();
    if (!title) continue;
    const date = parseDate(a.closest("tr").text());
    if (date) { seen.add(m[1]); items.push({ vid: m[1], title, date }); }
  }
  return items;
}

async function fetchDetail(board: string, vid: string) {
  const html = await fetchHtml(webUrl(board, vid));
  const $ = load(html);
  const cont = $(".editable-content").first();

  let bodyText = cont.text();
  bodyText = bodyText.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const images: string[] = [];
  cont.find("img").each((_, el) => {
    let src = $(el).attr("src");
    if (!src || src.startsWith("data:")) return;
    if (!/^https?:\/\//.test(src)) src = BASE + (src.startsWith("/") ? src : "/" + src);
    images.push(src);
  });

  const attachments: string[] = [];
  $(".file-download a[href], a[href*='download'], a[href*='file']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href || href === "#" || href.startsWith("javascript")) return;
    const full = /^https?:\/\//.test(href) ? href : BASE + (href.startsWith("/") ? href : "/" + href);
    if (!attachments.includes(full)) attachments.push(full);
  });

  return { bodyText, images, attachments };
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const auth = req.headers.get("Authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let pages = 1;
  let backfillOverride: string | null = null;
  try {
    const body = await req.json();
    if (body && Number.isInteger(body.pages) && body.pages > 0) pages = Math.min(body.pages, 30);
    if (body && typeof body.backfillFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.backfillFrom)) backfillOverride = body.backfillFrom;
  } catch { /* cron 빈 body */ }

  const { data: source, error: sErr } = await supabase
    .from("sources").select("id").eq("parser_key", SOURCE_PARSER_KEY).single();
  if (sErr || !source) {
    return new Response(JSON.stringify({ error: `source not found: ${SOURCE_PARSER_KEY}` }), { status: 500 });
  }
  const sourceId = source.id;

  const stats = { boards: 0, listed: 0, skippedOld: 0, skippedDup: 0, insertedNotices: 0, fetchFailed: 0 };

  try {
    for (const [board, category, boardBackfill] of BOARDS) {
      const backfillFrom = backfillOverride ?? boardBackfill;
      stats.boards++;
      for (let page = 1; page <= pages; page++) {
        const rawItems = await fetchListPage(board, page);
        stats.listed += rawItems.length;
        if (rawItems.length === 0) break;

        for (const it of rawItems) {
          if (it.date < backfillFrom) { stats.skippedOld++; continue; }

          const postedAt = `${it.date}T00:00:00+09:00`;
          const url = webUrl(board, it.vid);
          try {
            const contentHash = await sha256Hex(`${it.title}|${url}|${postedAt}`);
            const { data: existing } = await supabase
              .from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
            if (existing) { stats.skippedDup++; continue; }

            const detail = await fetchDetail(board, it.vid);

            const { error: insErr } = await supabase.from("notices").insert({
              source_id: sourceId,
              source_category: category,
              title: it.title,
              body_text: detail.bodyText,
              body_image_urls: detail.images,
              attachment_urls: detail.attachments,
              source_url: url,
              author: "국어국문학부",
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
            console.error(`item ${board}/${it.vid}: ${(e as Error).message}`);
            stats.fetchFailed++;
          }
          await sleep(400);
        }
        if (page < pages) await sleep(800);
      }
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
