// cau_swedu — SW교육원(swedu.cau.ac.kr) 공지 크롤러 (독립기관)
//
// 게시판: /board/list?boardtypeid=7&menuid=001005005&pagesize=100 (한 번에 다수)
//   행: a[href*="view?...boardid=N"](제목) + 날짜(YYYY-MM-DD)
// 상세: /board/view?menuid=001005005&boardtypeid=7&boardid={id} → 본문 .content_inner
//
// 독립기관 → owner_unit 없음(본문 명시 학과만 한정 = 사실상 전체). 인증: Bearer <CRON_SECRET>.

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_swedu";
const BASE = "https://swedu.cau.ac.kr";
const MENU_ID = "001005005";
const BOARD_TYPE_ID = "7";
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

function viewUrl(boardid: string): string {
  return `${BASE}/board/view?menuid=${MENU_ID}&boardtypeid=${BOARD_TYPE_ID}&boardid=${boardid}`;
}

type ListItem = { boardid: string; title: string; date: string };

function parseList(html: string): ListItem[] {
  const $ = load(html);
  const items: ListItem[] = [];
  const seen = new Set<string>();
  $("a[href*='view?'][href*='boardid=']").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(/boardid=(\d+)/);
    if (!m || seen.has(m[1])) return;
    const title = $(a).text().replace(/\s+/g, " ").trim();
    if (!title) return;
    const date = parseDate($(a).closest("tr").text());
    if (!date) return;
    seen.add(m[1]);
    items.push({ boardid: m[1], title, date });
  });
  return items;
}

async function fetchDetail(boardid: string) {
  const html = await fetchHtml(viewUrl(boardid));
  const $ = load(html);
  const cont = $(".content_inner").first();

  // .content_inner 앞쪽 브레드크럼/제목 노이즈는 '첨부파일' 이후 본문이 이어지므로 텍스트 그대로 사용.
  let bodyText = cont.text().replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const images: string[] = [];
  cont.find("img").each((_, el) => {
    let src = $(el).attr("src");
    if (!src) return;
    if (src.startsWith("//")) src = "https:" + src;
    else if (!/^https?:\/\//.test(src)) src = BASE + (src.startsWith("/") ? src : "/" + src);
    images.push(src);
  });

  const attachments: string[] = [];
  cont.find("a[href*='download'], a[href*='/file'], a[href*='attach']").each((_, el) => {
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

  let backfillFrom = DEFAULT_BACKFILL;
  let pagesize = 100;
  try {
    const body = await req.json();
    if (body && typeof body.backfillFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.backfillFrom)) backfillFrom = body.backfillFrom;
    if (body && Number.isInteger(body.pagesize) && body.pagesize > 0) pagesize = Math.min(body.pagesize, 300);
  } catch { /* cron 빈 body */ }

  const { data: source, error: sErr } = await supabase
    .from("sources").select("id").eq("parser_key", SOURCE_PARSER_KEY).single();
  if (sErr || !source) {
    return new Response(JSON.stringify({ error: `source not found: ${SOURCE_PARSER_KEY}` }), { status: 500 });
  }
  const sourceId = source.id;

  const stats = { listed: 0, skippedOld: 0, skippedDup: 0, insertedNotices: 0, fetchFailed: 0 };

  try {
    const html = await fetchHtml(`${BASE}/board/list?boardtypeid=${BOARD_TYPE_ID}&menuid=${MENU_ID}&pagesize=${pagesize}`);
    const rawItems = parseList(html);
    stats.listed += rawItems.length;

    for (const it of rawItems) {
      if (it.date < backfillFrom) { stats.skippedOld++; continue; }

      const postedAt = `${it.date}T00:00:00+09:00`;
      const url = viewUrl(it.boardid);
      try {
        const contentHash = await sha256Hex(`${it.title}|${SOURCE_PARSER_KEY}/${it.boardid}|${postedAt}`);
        const { data: existing } = await supabase
          .from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
        if (existing) { stats.skippedDup++; continue; }

        const detail = await fetchDetail(it.boardid);

        const { error: insErr } = await supabase.from("notices").insert({
          source_id: sourceId,
          source_category: null,
          title: it.title,
          body_text: detail.bodyText,
          body_image_urls: detail.images,
          attachment_urls: detail.attachments,
          source_url: url,
          author: "SW교육원",
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
        console.error(`item ${it.boardid}: ${(e as Error).message}`);
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
