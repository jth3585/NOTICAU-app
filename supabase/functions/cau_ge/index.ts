// cau_ge — 교양대학(ge.cau.ac.kr) 공지 크롤러
//
// 목록: GET /board_notice.php → a[href*="board_notice_view.php?no={no}"](제목) + 날짜(YYYY-MM-DD)
// 상세: GET /board_notice_view.php?no={no}&page=1 → 본문 .view_con, 첨부 .view_file a[download.php]
//        ※ 목록 1페이지가 1년+ 깊이라 5월 백필 충분 → 단일 페이지.
//
// 소속: 교양대학(전교생 대상 — owner 없음, LLM이 본문 명시 대상만 한정). 인증: Bearer <CRON_SECRET>.

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_ge";
const BASE = "https://ge.cau.ac.kr";
const LIST_PATH = "/board_notice.php";
const AUTHOR = "교양대학";
const DEFAULT_BACKFILL = "2026-05-01";

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [1_000, 3_000];
const POLITE_DELAY_MS = 300;

const REQUEST_HEADERS = {
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

function abs(href: string): string {
  if (/^https?:\/\//.test(href)) return href;
  return `${BASE}/${href.replace(/^\//, "")}`;
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

function viewUrl(no: string): string {
  return `${BASE}/board_notice_view.php?no=${no}&page=1`;
}

type ListItem = { no: string; title: string; date: string };

function parseList(html: string): ListItem[] {
  const $ = load(html);
  const items: ListItem[] = [];
  const seen = new Set<string>();
  $("a[href*='board_notice_view.php?no=']").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(/no=(\d+)/);
    if (!m || seen.has(m[1])) return;
    const title = $(a).text().replace(/\s+/g, " ").trim();
    if (!title || title.length < 2) return;
    const date = parseDate($(a).closest("tr").text());
    if (!date) return;
    seen.add(m[1]);
    items.push({ no: m[1], title, date });
  });
  return items;
}

async function fetchDetail(no: string) {
  const html = await fetchHtml(viewUrl(no));
  const $ = load(html);
  const cont = $(".view_con").first();

  let bodyText = cont.text().replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const images: string[] = [];
  cont.find("img").each((_, el) => {
    let src = $(el).attr("src");
    if (!src || src.startsWith("data:")) return;
    if (src.startsWith("//")) src = "https:" + src;
    else if (!/^https?:\/\//.test(src)) src = abs(src);
    images.push(src);
  });

  const attachments: string[] = [];
  $(".view_file a[href*='download.php'], a[href*='download.php']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href || href.startsWith("javascript")) return;
    const full = abs(href);
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

  let backfillFrom = DEFAULT_BACKFILL;
  try {
    const body = await req.json();
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
    const html = await fetchHtml(`${BASE}${LIST_PATH}`);
    const rawItems = parseList(html);
    stats.listed += rawItems.length;

    for (const it of rawItems) {
      if (it.date < backfillFrom) { stats.skippedOld++; continue; }

      const postedAt = `${it.date}T00:00:00+09:00`;
      const url = viewUrl(it.no);
      try {
        const contentHash = await sha256Hex(`${it.title}|${SOURCE_PARSER_KEY}/${it.no}|${postedAt}`);
        const { data: existing } = await supabase
          .from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
        if (existing) { stats.skippedDup++; continue; }

        const detail = await fetchDetail(it.no);

        const { error: insErr } = await supabase.from("notices").insert({
          source_id: sourceId,
          source_category: null,
          title: it.title,
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
        console.error(`item ${it.no}: ${(e as Error).message}`);
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
