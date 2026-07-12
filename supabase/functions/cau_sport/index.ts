// cau_sport — 체육대학(sport.cau.ac.kr) 공지 크롤러 (Rhymix CMS)
//
// 목록: GET /u2_notice(?page=N) → a[href*="/u2_notice/{document_srl}"](제목 .title) + 같은 행 날짜(YYYY.MM.DD)
// 상세: GET /u2_notice/{document_srl} → 본문 .xe_content, 첨부 a[href*="procFileDownload"]
//
// 소속: 체육대학(pe_anseong, college, 안성). 인증: Bearer <CRON_SECRET>.
// ※ Rhymix ?page= 파라미터가 이 테마에선 동작 안 함 → 1페이지가 수개월치 커버(백필 충분).
//    같은 첫 글이 반복되면 페이지 루프 중단(무한 재조회 방지).

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_sport";
const BASE = "http://sport.cau.ac.kr";
const LIST_PATH = "/u2_notice";
const AUTHOR = "체육대학";
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
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function abs(href: string): string {
  if (/^https?:\/\//.test(href)) return href;
  if (href.startsWith("//")) return "http:" + href;
  if (href.startsWith("/")) return BASE + href;
  return `${BASE}/${href}`;
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

function viewUrl(srl: string): string {
  return `${BASE}${LIST_PATH}/${srl}`;
}

type ListItem = { srl: string; title: string; date: string };

function parseList(html: string): ListItem[] {
  const $ = load(html);
  const items: ListItem[] = [];
  const seen = new Set<string>();
  $(`a[href*="${LIST_PATH}/"]`).each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(new RegExp(`${LIST_PATH}/(\\d+)`));
    if (!m || seen.has(m[1])) return;
    const title = $(a).text().replace(/\s+/g, " ").trim();
    if (!title || title.length < 2) return;
    const row = $(a).closest("tr, li");
    const date = parseDate(row.length ? row.text() : $(a).parent().text());
    if (!date) return;
    seen.add(m[1]);
    items.push({ srl: m[1], title, date });
  });
  return items;
}

async function fetchDetail(srl: string) {
  const html = await fetchHtml(viewUrl(srl));
  const $ = load(html);
  const cont = $(".xe_content").first();

  const bodyText = cont.text().replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const images: string[] = [];
  cont.find("img").each((_, el) => {
    let src = $(el).attr("src");
    if (!src || src.startsWith("data:")) return;
    images.push(abs(src));
  });

  const attachments: string[] = [];
  $("a[href*='procFileDownload'], a[href*='/files/attach/']").each((_, el) => {
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
  let prevFirstSrl: string | null = null;

  try {
    for (let page = 1; page <= pages; page++) {
      const html = await fetchHtml(page <= 1 ? `${BASE}${LIST_PATH}` : `${BASE}${LIST_PATH}?page=${page}`);
      const rawItems = parseList(html);
      if (rawItems.length === 0) break;
      // ?page= 미동작 시 같은 첫 글 반복 → 중단(무한 재조회 방지)
      if (prevFirstSrl && rawItems[0].srl === prevFirstSrl) break;
      prevFirstSrl = rawItems[0].srl;
      stats.listed += rawItems.length;

      for (const it of rawItems) {
        if (it.date < backfillFrom) { stats.skippedOld++; continue; }

        const postedAt = `${it.date}T00:00:00+09:00`;
        const url = viewUrl(it.srl);
        try {
          const contentHash = await sha256Hex(`${it.title}|${SOURCE_PARSER_KEY}/${it.srl}|${postedAt}`);
          const { data: existing } = await supabase
            .from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
          if (existing) { stats.skippedDup++; continue; }

          const detail = await fetchDetail(it.srl);

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
          console.error(`item ${it.srl}: ${(e as Error).message}`);
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
