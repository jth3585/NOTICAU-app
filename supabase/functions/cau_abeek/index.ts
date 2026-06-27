// cau_abeek — 공학교육혁신센터(abeek.cau.ac.kr) 공지 크롤러
//
// 목록: https://abeek.cau.ac.kr/em/notice.jsp?page=N  (JSP, GET)
//   a.btnView[seq] (제목), 같은 tr: 카테고리 td(공지/행사), 날짜 td(YYYY.MM.DD)
// 상세: /em/view.jsp?act=view&sc_board_seq=1&pk_seq={seq} (GET) → div.bo-cont(본문), .file a(첨부)
//
// 백필 정책: 2026-05-01 이후(posted_at) 글만 적재(BACKFILL_FROM). 그 이전(상단고정 포함)은 skip.
// 설계: 크롤+notices INSERT만 (LLM은 별도 llm_classify). 인증: Bearer <CRON_SECRET>.
// content_hash = sha256(title|source_url|posted_at) — 기존 크롤러와 동일(dedup 호환).

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_abeek";
const BASE = "https://abeek.cau.ac.kr";
const LIST_PATH = "/em/notice.jsp";
const BACKFILL_FROM = "2026-05-01"; // 이 날짜(KST) 이전 글은 적재하지 않음

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

// "2026.04.16" (KST) → "2026-04-16T00:00:00+09:00"
function toIso(date: string): string {
  const s = (date || "").trim().replace(/\./g, "-");
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00+09:00` : "";
}
// "2026.04.16" → "2026-04-16" (백필 비교용)
function toYmd(date: string): string {
  return (date || "").trim().replace(/\./g, "-");
}

function webUrl(seq: string): string {
  return `${BASE}/em/view.jsp?act=view&sc_board_seq=1&pk_seq=${seq}`;
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

type ListItem = { seq: string; title: string; date: string; category: string | null };

// 목록 한 페이지
async function fetchListPage(page: number): Promise<ListItem[]> {
  const url = page <= 1 ? `${BASE}${LIST_PATH}` : `${BASE}${LIST_PATH}?page=${page}`;
  const html = await fetchHtml(url);
  const $ = load(html);
  const items: ListItem[] = [];
  $("a.btnView").each((_, a) => {
    const seq = ($(a).attr("seq") ?? "").trim();
    const title = $(a).text().trim();
    if (!seq || !title) return;
    const tr = $(a).closest("tr");
    let date = "";
    tr.find("td").each((_, td) => {
      const t = $(td).text().trim();
      if (/^\d{4}\.\d{2}\.\d{2}$/.test(t)) date = t;
    });
    const category = tr.find("td").eq(1).text().trim() || null;
    if (date) items.push({ seq, title, date, category });
  });
  return items;
}

// 상세 (본문 HTML → 텍스트/이미지, 첨부)
async function fetchDetail(seq: string) {
  const html = await fetchHtml(webUrl(seq));
  const $ = load(html);
  const cont = $(".bo-cont");

  let bodyText = cont.text();
  bodyText = bodyText.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const images: string[] = [];
  cont.find("img").each((_, el) => {
    let src = $(el).attr("src");
    if (!src) return;
    if (!/^https?:\/\//.test(src)) src = BASE + (src.startsWith("/") ? src : "/" + src);
    images.push(src);
  });

  // 첨부: .file 영역의 다운로드 링크(/common/bulletin_download.jsp?seq=...)
  const attachments: string[] = [];
  $(".file a[href]").each((_, el) => {
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
        if (toYmd(it.date) < backfillFrom) { stats.skippedOld++; continue; }

        const postedAt = toIso(it.date);
        const url = webUrl(it.seq);
        try {
          const contentHash = await sha256Hex(`${it.title}|${url}|${postedAt}`);
          const { data: existing } = await supabase
            .from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
          if (existing) { stats.skippedDup++; continue; }

          const detail = await fetchDetail(it.seq);

          const { error: insErr } = await supabase.from("notices").insert({
            source_id: sourceId,
            source_category: it.category,
            title: it.title,
            body_text: detail.bodyText,
            body_image_urls: detail.images,
            attachment_urls: detail.attachments,
            source_url: url,
            author: "공학교육혁신센터",
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
          console.error(`item ${it.seq}: ${(e as Error).message}`);
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
