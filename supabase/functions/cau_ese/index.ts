// cau_ese — 에너지시스템공학부(cauese.co.kr) 공지 크롤러 (WordPress 블로그, 커뮤니티 term=4)
//
// 목록: GET /커뮤니티/?term=4 (2p+: /커뮤니티/page/N/?term=4)
//        → a.entry-title 내 a[rel=bookmark](제목 + 퍼머링크). term=4=공지사항 카테고리.
// 상세: GET {permalink} → 본문 .entry-content, 게시일 time.entry-date[datetime](ISO).
//
// 소속: 공과대학 에너지시스템공학부(energy_sys 단독). 인증: Bearer <CRON_SECRET>.

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_ese";
const BASE = "http://cauese.co.kr";
const LIST_PATH = "/%EC%BB%A4%EB%AE%A4%EB%8B%88%ED%8B%B0/"; // /커뮤니티/
const TERM = "4"; // 공지사항 카테고리
const AUTHOR = "에너지시스템공학부";
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

async function fetchHtml(url: string): Promise<string | null> {
  await sleep(POLITE_DELAY_MS);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (res.status === 404) return null; // 마지막 페이지 초과
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

function listUrl(page: number): string {
  return page <= 1
    ? `${BASE}${LIST_PATH}?term=${TERM}`
    : `${BASE}${LIST_PATH}page/${page}/?term=${TERM}`;
}

type ListItem = { url: string; title: string; key: string };

function parseList(html: string): ListItem[] {
  const $ = load(html);
  const items: ListItem[] = [];
  const seen = new Set<string>();
  $(".entry-title a[rel='bookmark'], h3.entry-title a").each((_, a) => {
    let href = $(a).attr("href") ?? "";
    if (!href) return;
    if (!/^https?:\/\//.test(href)) href = BASE + (href.startsWith("/") ? href : "/" + href);
    // 카테고리/인덱스 링크 제외 — 단일 포스트 퍼머링크만
    if (/\/category\/|\/page\/|[?#]|\/tag\//.test(href)) return;
    if (href.replace(/\/$/, "") === `${BASE}${LIST_PATH}`.replace(/\/$/, "")) return;
    const title = $(a).text().replace(/\s+/g, " ").trim();
    if (!title || title.length < 2) return;
    // 퍼머링크의 슬러그를 안정적 키로 사용
    const key = decodeURIComponent(href).replace(/\/$/, "").split("/").pop() || href;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ url: href, title, key });
  });
  return items;
}

async function fetchDetail(url: string) {
  const html = await fetchHtml(url);
  if (html === null) return null;
  const $ = load(html);
  const cont = $(".entry-content").first();

  const bodyText = cont.text().replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const images: string[] = [];
  cont.find("img").each((_, el) => {
    let src = $(el).attr("src") || $(el).attr("data-src");
    if (!src || src.startsWith("data:")) return;
    if (src.startsWith("//")) src = "http:" + src;
    else if (!/^https?:\/\//.test(src)) src = BASE + (src.startsWith("/") ? src : "/" + src);
    images.push(src);
  });

  const attachments: string[] = [];
  cont.find("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (/\/wp-content\/uploads\/.*\.(pdf|hwp|hwpx|docx?|xlsx?|pptx?|zip|jpg|png)/i.test(href)) {
      if (!attachments.includes(href)) attachments.push(href);
    }
  });

  // 게시일: time.entry-date[datetime="2026-07-06T11:50:00+09:00"]
  let postedAt: string | null = null;
  const dt = $("time.entry-date").first().attr("datetime") || $("time[datetime]").first().attr("datetime");
  if (dt) {
    const m = dt.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) postedAt = /T/.test(dt) ? dt : `${m[1]}-${m[2]}-${m[3]}T00:00:00+09:00`;
  }
  return { bodyText, images, attachments, postedAt };
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
      const html = await fetchHtml(listUrl(page));
      if (html === null) break;
      const rawItems = parseList(html);
      stats.listed += rawItems.length;
      if (rawItems.length === 0) break;

      for (const it of rawItems) {
        try {
          const detail = await fetchDetail(it.url);
          if (!detail || !detail.postedAt) { stats.fetchFailed++; continue; }
          const date = detail.postedAt.slice(0, 10);
          if (date < backfillFrom) { stats.skippedOld++; continue; }

          const contentHash = await sha256Hex(`${it.title}|${SOURCE_PARSER_KEY}/${it.key}|${date}`);
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
            source_url: it.url,
            author: AUTHOR,
            posted_at: detail.postedAt,
            is_pinned: false,
            content_hash: contentHash,
          });
          if (insErr) {
            if (insErr.code === "23505") { stats.skippedDup++; continue; }
            throw insErr;
          }
          stats.insertedNotices++;
        } catch (e) {
          console.error(`item ${it.key}: ${(e as Error).message}`);
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
