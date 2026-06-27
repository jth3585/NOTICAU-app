// cau_iacf — 산학협력단(iacf.cau.ac.kr) 공지 크롤러
//
// 목록: https://iacf.cau.ac.kr/service/notice?pageIndex=N  (자체 CMS, HTML)
//   tbody tr → td.alignL a[href=/service/notice/view/{id}] (제목), 마지막 td = 작성일(YYYY-MM-DD)
// 상세: /service/notice/view/{id} → div.bv-cont (본문)
//
// 백필 정책: 2026-06-01 이후(posted_at) 글만 적재(BACKFILL_FROM). 그 이전(상단고정 포함)은 skip.
// 설계: 크롤+notices INSERT만 (LLM은 별도 llm_classify). 인증: Bearer <CRON_SECRET>.
// content_hash = sha256(title|source_url|posted_at) — 기존 크롤러와 동일(dedup 호환).

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_iacf";
const BASE = "https://iacf.cau.ac.kr";
const LIST_PATH = "/service/notice";
const BACKFILL_FROM = "2026-06-01"; // 이 날짜(KST) 이전 글은 적재하지 않음

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [1_000, 3_000];
const POLITE_DELAY_MS = 300;

const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
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

// "2026-06-26" (KST, 시간 없음) → "2026-06-26T00:00:00+09:00"
function toIso(date: string): string {
  const s = (date || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00+09:00` : "";
}

function webUrl(id: string): string {
  return `${BASE}${LIST_PATH}/view/${id}`;
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

type ListItem = { id: string; title: string; date: string };

// 목록 한 페이지
async function fetchListPage(pageIndex: number): Promise<ListItem[]> {
  const url = pageIndex <= 1 ? `${BASE}${LIST_PATH}` : `${BASE}${LIST_PATH}?pageIndex=${pageIndex}`;
  const html = await fetchHtml(url);
  const $ = load(html);
  const items: ListItem[] = [];
  $("tbody tr").each((_, tr) => {
    const a = $(tr).find("td.alignL a").first();
    const href = a.attr("href") ?? "";
    const m = href.match(/\/view\/(\d+)/);
    if (!m) return;
    const title = a.text().trim();
    // 작성일: YYYY-MM-DD 형태의 td (마지막 td 또는 매칭)
    let date = "";
    $(tr).find("td").each((_, td) => {
      const t = $(td).text().trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) date = t;
    });
    if (title && date) items.push({ id: m[1], title, date });
  });
  return items;
}

// 상세 (본문 HTML → 텍스트/이미지)
async function fetchDetail(id: string) {
  const html = await fetchHtml(webUrl(id));
  const $ = load(html);
  const cont = $(".bv-cont");

  let bodyText = cont.text();
  bodyText = bodyText.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const images: string[] = [];
  cont.find("img").each((_, el) => {
    let src = $(el).attr("src");
    if (!src) return;
    if (!/^https?:\/\//.test(src)) src = BASE + (src.startsWith("/") ? src : "/" + src);
    images.push(src);
  });

  // 첨부: 본문 밖 div.bv-file 영역의 다운로드 링크(/bbs/file/download/...)
  const attachments: string[] = [];
  $(".bv-file a[href]").each((_, el) => {
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
  let backfillFrom = BACKFILL_FROM;
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

  const stats = { pages: 0, listed: 0, skippedOld: 0, skippedDup: 0, insertedNotices: 0, fetchFailed: 0 };

  try {
    for (let page = 1; page <= pages; page++) {
      const rawItems = await fetchListPage(page);
      stats.listed += rawItems.length;
      stats.pages++;
      if (rawItems.length === 0) break;

      for (const it of rawItems) {
        // 백필 정책: 기준일 이전 글은 적재하지 않음(상단고정 과거글 포함)
        if (it.date < backfillFrom) { stats.skippedOld++; continue; }

        const postedAt = toIso(it.date);
        const url = webUrl(it.id);
        try {
          const contentHash = await sha256Hex(`${it.title}|${url}|${postedAt}`);
          const { data: existing } = await supabase
            .from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
          if (existing) { stats.skippedDup++; continue; }

          const detail = await fetchDetail(it.id);

          const { error: insErr } = await supabase.from("notices").insert({
            source_id: sourceId,
            source_category: null,
            title: it.title,
            body_text: detail.bodyText,
            body_image_urls: detail.images,
            attachment_urls: detail.attachments,
            source_url: url,
            author: "산학협력단",
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
      if (page < pages) await sleep(1000);
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
