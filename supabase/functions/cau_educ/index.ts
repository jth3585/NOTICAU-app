// cau_educ — 교육학과(education.cau.ac.kr) 공지 크롤러 (gnuboard)
//
// 목록: GET /bbs/board.php?bo_table={BO}&page=N → a[href*="wr_id=N"](제목)
// 상세: GET /bbs/board.php?bo_table={BO}&wr_id={id} → 본문 .view-content ‖ #bo_v_con,
//        게시일은 본문 앞 헤더의 날짜(YYYY-MM-DD 또는 YY-MM-DD), 첨부 download.php
//
// 소속: 교육학과(edu 단독). 인증: Bearer <CRON_SECRET>.

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_educ";
const BASE = "https://education.cau.ac.kr";
const BO_TABLE = "s0301";
const AUTHOR = "교육학과";
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

function abs(href: string): string {
  if (/^https?:\/\//.test(href)) return href;
  if (href.startsWith("/")) return BASE + href;
  return `${BASE}/bbs/${href.replace(/^\.\//, "")}`;
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

function viewUrl(id: string): string {
  return `${BASE}/bbs/board.php?bo_table=${BO_TABLE}&wr_id=${id}`;
}

// 상세 HTML에서 게시일 추출: 본문 컨테이너 '앞' 영역(헤더)의 마지막 날짜.
function extractPostedDate(html: string): string | null {
  let bodyIdx = html.search(/class="[^"]*view-content/);
  if (bodyIdx < 0) bodyIdx = html.indexOf('id="bo_v_con"');
  const head = bodyIdx > 0 ? html.slice(0, bodyIdx) : html;
  const all = [...head.matchAll(/(\d{2,4})[.\-](\d{2})[.\-](\d{2})/g)];
  if (all.length === 0) return null;
  const m = all[all.length - 1];
  const y = m[1].length === 2 ? `20${m[1]}` : m[1];
  return `${y}-${m[2]}-${m[3]}`;
}

type ListItem = { id: string; title: string };

function parseList(html: string): ListItem[] {
  const $ = load(html);
  const items: ListItem[] = [];
  const seen = new Set<string>();
  $("a[href*='wr_id=']").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(/wr_id=(\d+)/);
    if (!m || seen.has(m[1])) return;
    const title = $(a).text().replace(/\s+/g, " ").trim();
    if (!title || title.length < 2) return;
    seen.add(m[1]);
    items.push({ id: m[1], title });
  });
  return items;
}

async function fetchDetail(id: string) {
  const html = await fetchHtml(viewUrl(id));
  const $ = load(html);
  let cont = $(".view-content").first();
  if (!cont.length) cont = $("#bo_v_con").first();

  let bodyText = cont.text().replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const images: string[] = [];
  cont.find("img").each((_, el) => {
    let src = $(el).attr("src");
    if (!src) return;
    if (src.startsWith("//")) src = "https:" + src;
    else if (!/^https?:\/\//.test(src)) src = abs(src);
    images.push(src);
  });

  const attachments: string[] = [];
  $("a[href*='download.php']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href || href.startsWith("javascript")) return;
    const full = abs(href);
    if (!attachments.includes(full)) attachments.push(full);
  });

  return { bodyText, images, attachments, date: extractPostedDate(html) };
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
      const html = await fetchHtml(`${BASE}/bbs/board.php?bo_table=${BO_TABLE}&page=${page}`);
      const rawItems = parseList(html);
      stats.listed += rawItems.length;
      if (rawItems.length === 0) break;

      for (const it of rawItems) {
        const url = viewUrl(it.id);
        try {
          // 게시일을 상세에서 권위 추출 → 사전 임시해시 없이 상세 1회 조회
          const detail = await fetchDetail(it.id);
          const date = detail.date;
          if (!date) { stats.fetchFailed++; continue; }
          if (date < backfillFrom) { stats.skippedOld++; continue; }

          const postedAt = `${date}T00:00:00+09:00`;
          const contentHash = await sha256Hex(`${it.title}|${SOURCE_PARSER_KEY}/${it.id}|${postedAt}`);
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
          console.error(`item ${it.id}: ${(e as Error).message}`);
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
