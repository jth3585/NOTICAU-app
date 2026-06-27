// cau_security — 산업보안학과(security.cau.ac.kr) 공지사항 크롤러
//
// 목록: https://security.cau.ac.kr/board.htm?bbsid=notice&page=N  (EUC-KR 인코딩)
//   tr > a[href*="mode=view&bltn_seq=N"](제목), 행 마지막 td(날짜 YYYY.MM.DD)
// 상세: board.htm?bbsid=notice&mode=view&bltn_seq={n} → .cont(본문)
//
// 주의: EUC-KR 인코딩이라 arrayBuffer를 TextDecoder('euc-kr')로 디코딩한다.
// 백필 2026-05-01. 인증: Bearer <CRON_SECRET>.

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_security";
const BASE = "https://security.cau.ac.kr";
const LIST_PATH = "/board.htm";
const BACKFILL_FROM = "2026-05-01";

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [1_000, 3_000];
const POLITE_DELAY_MS = 300;

const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "Referer": "https://security.cau.ac.kr/board.htm?bbsid=notice",
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

function webUrl(seq: string): string {
  return `${BASE}${LIST_PATH}?bbsid=notice&mode=view&bltn_seq=${seq}`;
}

// EUC-KR 디코딩 fetch
async function fetchHtml(url: string): Promise<string> {
  await sleep(POLITE_DELAY_MS);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const buf = await res.arrayBuffer();
      return new TextDecoder("euc-kr").decode(buf);
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

type ListItem = { seq: string; title: string; date: string };

async function fetchListPage(page: number): Promise<ListItem[]> {
  const html = await fetchHtml(`${BASE}${LIST_PATH}?bbsid=notice&page=${page}`);
  const $ = load(html);
  const items: ListItem[] = [];
  const seen = new Set<string>();
  const links = $("a[href*='mode=view']");
  for (let i = 0; i < links.length; i++) {
    const a = links.eq(i);
    const href = a.attr("href") ?? "";
    const m = href.match(/bltn_seq=(\d+)/);
    if (!m || seen.has(m[1])) continue;
    const title = a.text().replace(/\s+/g, " ").trim();
    if (!title) continue;
    const date = parseDate(a.closest("tr").text());
    if (date) { seen.add(m[1]); items.push({ seq: m[1], title, date }); }
  }
  return items;
}

async function fetchDetail(seq: string) {
  const html = await fetchHtml(webUrl(seq));
  const $ = load(html);
  const cont = $(".cont").first();

  let bodyText = cont.text();
  bodyText = bodyText.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const images: string[] = [];
  cont.find("img").each((_, el) => {
    let src = $(el).attr("src");
    if (!src) return;
    if (!/^https?:\/\//.test(src)) src = BASE + (src.startsWith("/") ? src : "/" + src);
    images.push(src);
  });

  const attachments: string[] = [];
  $("a[href*='download'], a[href*='filedown'], a[href*='/bbs_data/'], a[href*='file.htm']").each((_, el) => {
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
        if (it.date < backfillFrom) { stats.skippedOld++; continue; }

        const postedAt = `${it.date}T00:00:00+09:00`;
        const url = webUrl(it.seq);
        try {
          const contentHash = await sha256Hex(`${it.title}|${url}|${postedAt}`);
          const { data: existing } = await supabase
            .from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
          if (existing) { stats.skippedDup++; continue; }

          const detail = await fetchDetail(it.seq);

          const { error: insErr } = await supabase.from("notices").insert({
            source_id: sourceId,
            source_category: null,
            title: it.title,
            body_text: detail.bodyText,
            body_image_urls: detail.images,
            attachment_urls: detail.attachments,
            source_url: url,
            author: "산업보안학과",
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
