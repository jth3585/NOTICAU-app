// cau_euro — 유럽문화학부(caueurope.cau.ac.kr) 공지사항 크롤러 (커스텀 CMS, M14 모듈)
//
// 목록+본문이 한 응답에 인라인으로 들어온다(상세 별도 요청 없음):
//   POST /ModulePrint/ModuleContents/M14/M14_contents_list_ajax_1.php
//     body: p_page=N&code=M14&PageId=1621211753&s_text=
//   각 행: a.open-popup-link[href="#test-popup-{id}"](제목) + td(YYYY.MM.DD 날짜)
//          + div#test-popup-{id}(본문) — 페이지당 4건.
//
// 소속: 유럽문화학부(독일·프랑스·러시아어문학 3학과). 학과 한정 타게팅은 llm_classify에서
//       3개 코드로 확장(OWNER_DEPT_GROUP). 인증: Bearer <CRON_SECRET>.

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_euro";
const BASE = "https://caueurope.cau.ac.kr";
const AJAX_URL = `${BASE}/ModulePrint/ModuleContents/M14/M14_contents_list_ajax_1.php`;
const BOARD_CODE = "M14";
const BOARD_PAGE_ID = "1621211753";
const DEFAULT_BACKFILL = "2026-05-01";
const SOURCE_CATEGORY: string | null = null;

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [1_000, 3_000];
const POLITE_DELAY_MS = 300;

const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "X-Requested-With": "XMLHttpRequest",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
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

function absUrl(href: string): string {
  if (/^https?:\/\//.test(href)) return href;
  return BASE + (href.startsWith("/") ? href : "/" + href);
}

async function fetchListPage(page: number): Promise<string> {
  await sleep(POLITE_DELAY_MS);
  const body = new URLSearchParams({ p_page: String(page), code: BOARD_CODE, PageId: BOARD_PAGE_ID, s_text: "" }).toString();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(AJAX_URL, { method: "POST", headers: REQUEST_HEADERS, body, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${AJAX_URL} p${page}`);
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

type ListItem = { id: string; title: string; date: string; bodyText: string; images: string[]; attachments: string[] };

const DATE_RE = /^\s*\d{4}[.\-]\d{2}[.\-]\d{2}\s*$/;

function parseList(html: string): ListItem[] {
  const $ = load(html);
  const items: ListItem[] = [];
  const seen = new Set<string>();
  $("a.open-popup-link").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(/test-popup-(\d+)/);
    if (!m || seen.has(m[1])) return;
    const id = m[1];
    const title = $(a).text().replace(/\s+/g, " ").trim();
    if (!title) return;

    // 날짜: 같은 행에서 'YYYY.MM.DD'만 든 td (본문 팝업 div가 제목 td 안에 있어 행 전체 텍스트는 못 씀)
    const row = $(a).closest("tr");
    let date: string | null = null;
    row.find("td").each((_, td) => {
      const t = $(td).text();
      if (DATE_RE.test(t)) { date = parseDate(t); return false; }
    });
    if (!date) return;

    const popup = $(`#test-popup-${id}`);
    let bodyText = popup.text().replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    // 본문 앞에 제목이 중복되면 1회 제거
    if (bodyText.startsWith(title)) bodyText = bodyText.slice(title.length).trim();

    const images: string[] = [];
    popup.find("img").each((_, el) => {
      const src = $(el).attr("src");
      if (src && !src.startsWith("data:")) images.push(absUrl(src));
    });
    const attachments: string[] = [];
    popup.find("a[href*='filedown'], a[href*='download'], a[href*='file']").each((_, el) => {
      const fh = $(el).attr("href") ?? "";
      if (!fh || fh === "#" || fh.startsWith("javascript")) return;
      const full = absUrl(fh);
      if (!attachments.includes(full)) attachments.push(full);
    });

    seen.add(id);
    items.push({ id, title, date, bodyText, images, attachments });
  });
  return items;
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
      const html = await fetchListPage(page);
      const rawItems = parseList(html);
      stats.listed += rawItems.length;
      if (rawItems.length === 0) break;

      for (const it of rawItems) {
        if (it.date < backfillFrom) { stats.skippedOld++; continue; }

        const postedAt = `${it.date}T00:00:00+09:00`;
        const url = `${BASE}/?p_idx=${it.id}`; // 고정 상세 URL이 없어 식별용 의사 URL
        try {
          const contentHash = await sha256Hex(`${it.title}|${SOURCE_PARSER_KEY}/${it.id}|${postedAt}`);
          const { data: existing } = await supabase
            .from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
          if (existing) { stats.skippedDup++; continue; }

          const { error: insErr } = await supabase.from("notices").insert({
            source_id: sourceId,
            source_category: SOURCE_CATEGORY,
            title: it.title,
            body_text: it.bodyText,
            body_image_urls: it.images,
            attachment_urls: it.attachments,
            source_url: url,
            author: "유럽문화학부",
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
        await sleep(200);
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
