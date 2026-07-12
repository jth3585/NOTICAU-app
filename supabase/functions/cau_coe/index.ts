// cau_coe — 공과대학(coe.cau.ac.kr) 공지 크롤러 (자체 PHP 게시판)
//
// 목록: GET /sub/sub04_01.php?boardid=notice&offset=N (10건 단위) →
//        a[href*="mode=view&idx="](제목) + 같은 행 .date(YYYY-MM-DD)
// 상세: GET /sub/sub04_01.php?boardid=notice&mode=view&idx={idx} → 본문 .real-cont,
//        게시일 '관리자 YYYY-MM-DD', 첨부 onclick download('notice',b_idx,idx)
//        → /module/board/download.php?boardid=notice&b_idx=..&idx=..
//
// 소속: 공과대학(engineering, college). 인증: Bearer <CRON_SECRET>.

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_coe";
const BASE = "https://coe.cau.ac.kr";
const LIST_PATH = "/sub/sub04_01.php";
const BOARD_ID = "notice";
const PER_PAGE = 10; // offset 증가 단위
const AUTHOR = "공과대학";
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

const DATE_RE = /(\d{4})-(\d{2})-(\d{2})/;

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

function viewUrl(idx: string): string {
  return `${BASE}${LIST_PATH}?boardid=${BOARD_ID}&mode=view&idx=${idx}`;
}

type ListItem = { idx: string; title: string; listDate: string | null };

function parseList(html: string): ListItem[] {
  const $ = load(html);
  const items: ListItem[] = [];
  const seen = new Set<string>();
  $('a[href*="mode=view"]').each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(/idx=(\d+)/);
    if (!m || seen.has(m[1])) return;
    const idx = m[1];
    const title = $(a).text().replace(/\s+/g, " ").trim();
    if (!title || title.length < 2) return;
    // 같은 행(단일 링크 조상)에서 날짜 탐색
    let node = $(a);
    let listDate: string | null = null;
    for (let i = 0; i < 6; i++) {
      const up = node.parent();
      if (!up.length) break;
      const links = up.find('a[href*="mode=view"]').length;
      if (links > 1) break;
      node = up;
      const dm = node.find(".date").first().text().match(DATE_RE) ?? node.text().match(DATE_RE);
      if (dm) listDate = `${dm[1]}-${dm[2]}-${dm[3]}`;
    }
    seen.add(idx);
    items.push({ idx, title, listDate });
  });
  return items;
}

async function fetchDetail(idx: string) {
  const html = await fetchHtml(viewUrl(idx));
  const $ = load(html);
  let cont = $(".real-cont").first();
  if (!cont.length) cont = $(".board-view").first();

  const bodyText = cont.text().replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const images: string[] = [];
  cont.find("img").each((_, el) => {
    let src = $(el).attr("src");
    if (!src || src.startsWith("data:")) return;
    if (src.startsWith("//")) src = "https:" + src;
    else if (src.startsWith("/")) src = BASE + src;
    else if (!/^https?:\/\//.test(src)) src = `${BASE}/${src}`;
    images.push(src);
  });

  // 첨부: onclick="download('notice','b_idx','idx')"
  const attachments: string[] = [];
  const dlRe = /download\('([^']+)','(\d+)','(\d+)'\)/g;
  let dm: RegExpExecArray | null;
  while ((dm = dlRe.exec(html)) !== null) {
    const url = `${BASE}/module/board/download.php?boardid=${dm[1]}&b_idx=${dm[2]}&idx=${dm[3]}`;
    if (!attachments.includes(url)) attachments.push(url);
  }

  // 게시일: '관리자 YYYY-MM-DD' 우선, 없으면 board-view 헤더의 첫 날짜
  const viewText = $(".board-view").first().text();
  let date: string | null = null;
  const am = viewText.match(/관리자\s*(\d{4})-(\d{2})-(\d{2})/);
  if (am) date = `${am[1]}-${am[2]}-${am[3]}`;
  else {
    const dd = viewText.match(DATE_RE);
    if (dd) date = `${dd[1]}-${dd[2]}-${dd[3]}`;
  }

  return { bodyText, images, attachments, date };
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

  const stats = { listed: 0, skippedOld: 0, skippedDup: 0, insertedNotices: 0, fetchFailed: 0 };

  try {
    for (let page = 1; page <= pages; page++) {
      const offset = (page - 1) * PER_PAGE;
      const html = await fetchHtml(`${BASE}${LIST_PATH}?boardid=${BOARD_ID}&offset=${offset}`);
      const rawItems = parseList(html);
      stats.listed += rawItems.length;
      if (rawItems.length === 0) break;

      for (const it of rawItems) {
        if (it.listDate && it.listDate < backfillFrom) { stats.skippedOld++; continue; }

        const url = viewUrl(it.idx);
        try {
          if (it.listDate) {
            const preHash = await sha256Hex(`${it.title}|${SOURCE_PARSER_KEY}/${it.idx}|${it.listDate}T00:00:00+09:00`);
            const { data: ex } = await supabase.from("notices").select("id").eq("content_hash", preHash).maybeSingle();
            if (ex) { stats.skippedDup++; continue; }
          }

          const detail = await fetchDetail(it.idx);
          const date = detail.date ?? it.listDate;
          if (!date) { stats.fetchFailed++; continue; }
          if (date < backfillFrom) { stats.skippedOld++; continue; }

          const postedAt = `${date}T00:00:00+09:00`;
          const contentHash = await sha256Hex(`${it.title}|${SOURCE_PARSER_KEY}/${it.idx}|${postedAt}`);
          const { data: existing } = await supabase
            .from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
          if (existing) { stats.skippedDup++; continue; }

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
          console.error(`item ${it.idx}: ${(e as Error).message}`);
          stats.fetchFailed++;
        }
        await sleep(400);
      }
      if (page < pages) await sleep(800);
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
