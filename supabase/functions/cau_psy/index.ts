// cau_psy — 심리학과(psyche.cau.ac.kr) 공지/취업 크롤러 (classic ASP)
//
// 게시판 2개: /community/sub01.asp(공지, tb=notice), /useful/sub02.asp(취업, tb=job)
// 목록: GET {board}?start=N (15개 단위) → a[href*="page=VIEW&IDX=N"](제목) + 날짜(YYYY.MM.DD or -)
// 상세: 목록 a의 href 그대로(page=VIEW&IDX&tb) → 본문은 가장 긴 td.bottom
//
// 소속: 심리학과(psychology 단독). 인증: Bearer <CRON_SECRET>.

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_psy";
const BASE = "https://psyche.cau.ac.kr";
// [board path, source_category]
const BOARDS: [string, string | null][] = [
  ["/community/sub01.asp", null],
  ["/useful/sub02.asp", "취업/공모"],
];
const PAGE_SIZE = 15;
const DEFAULT_BACKFILL = "2026-05-01";

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [1_000, 3_000];
const POLITE_DELAY_MS = 300;

const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "Referer": `${BASE}/`,
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

function abs(href: string): string {
  if (/^https?:\/\//.test(href)) return href;
  return BASE + (href.startsWith("/") ? href : "/" + href);
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
        console.warn(`[${SOURCE_PARSER_KEY}] fetch 실패 (${(err as Error).name}) → ${backoff}ms 후 재시도 ${attempt + 1}/${MAX_RETRIES}`);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

type ListItem = { idx: string; title: string; date: string; href: string };

function parseList(html: string): ListItem[] {
  const $ = load(html);
  const items: ListItem[] = [];
  const seen = new Set<string>();
  $("a[href*='IDX=']").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(/IDX=(\d+)/);
    if (!m || seen.has(m[1])) return;
    const title = $(a).text().replace(/\s+/g, " ").trim();
    if (!title) return;
    const date = parseDate($(a).closest("tr").text());
    if (!date) return;
    seen.add(m[1]);
    items.push({ idx: m[1], title, date, href: abs(href) });
  });
  return items;
}

async function fetchDetail(href: string) {
  const html = await fetchHtml(href);
  const $ = load(html);
  $("script, style").remove();

  // 본문: 가장 긴 td.bottom (ASP 레이아웃의 내용 셀)
  let cont = $();
  let maxLen = 0;
  $("td.bottom").each((_, el) => {
    const len = $(el).text().length;
    if (len > maxLen) { maxLen = len; cont = $(el); }
  });

  let bodyText = cont.text().replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const images: string[] = [];
  cont.find("img").each((_, el) => {
    const src = $(el).attr("src");
    if (src && !src.startsWith("data:")) images.push(abs(src));
  });

  const attachments: string[] = [];
  cont.find("a[href*='download'], a[href*='Download'], a[href*='/upload/'], a[href*='file']").each((_, el) => {
    const h = $(el).attr("href") ?? "";
    if (!h || h === "#" || h.startsWith("javascript")) return;
    const full = abs(h);
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
  let backfillFrom = DEFAULT_BACKFILL;
  try {
    const body = await req.json();
    if (body && Number.isInteger(body.pages) && body.pages > 0) pages = Math.min(body.pages, 30);
    if (body && typeof body.backfillFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.backfillFrom)) backfillFrom = body.backfillFrom;
  } catch { /* cron 빈 body */ }

  const { data: source, error: sErr } = await supabase
    .from("sources").select("id").eq("parser_key", SOURCE_PARSER_KEY).single();
  if (sErr || !source) {
    return new Response(JSON.stringify({ error: `source not found: ${SOURCE_PARSER_KEY}` }), { status: 500 });
  }
  const sourceId = source.id;

  const stats = { boards: 0, listed: 0, skippedOld: 0, skippedDup: 0, insertedNotices: 0, fetchFailed: 0 };

  try {
    for (const [board, category] of BOARDS) {
      stats.boards++;
      for (let page = 1; page <= pages; page++) {
        const start = (page - 1) * PAGE_SIZE + 1;
        const url = page <= 1 ? `${BASE}${board}` : `${BASE}${board}?start=${start}`;
        const rawItems = parseList(await fetchHtml(url));
        stats.listed += rawItems.length;
        if (rawItems.length === 0) break;

        for (const it of rawItems) {
          if (it.date < backfillFrom) { stats.skippedOld++; continue; }

          const postedAt = `${it.date}T00:00:00+09:00`;
          try {
            const contentHash = await sha256Hex(`${it.title}|${SOURCE_PARSER_KEY}${board}/${it.idx}|${postedAt}`);
            const { data: existing } = await supabase
              .from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
            if (existing) { stats.skippedDup++; continue; }

            const detail = await fetchDetail(it.href);

            const { error: insErr } = await supabase.from("notices").insert({
              source_id: sourceId,
              source_category: category,
              title: it.title,
              body_text: detail.bodyText,
              body_image_urls: detail.images,
              attachment_urls: detail.attachments,
              source_url: it.href,
              author: "심리학과",
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
            console.error(`item ${board}/${it.idx}: ${(e as Error).message}`);
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
