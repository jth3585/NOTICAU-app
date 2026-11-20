// cau_changup — 창업보육센터(changup.cau.ac.kr, 다빈치) 공지사항 크롤러 (imweb)
//
// 목록: https://changup.cau.ac.kr/Notice_01?page=N
//   각 글 ul > li.tit(제목; category 라벨/아이콘 포함), li.date(날짜 YYYY-MM-DD),
//   a[href*="bmode=view&idx="]가 상세 링크
// 상세: /Notice_01/?bmode=view&idx={idx}&t=board → .fr-view(본문)
//
// 캠퍼스: 창업보육센터는 다빈치 소재지만 창업·대회 등은 전교 대상이 많아 campus=both로 두고,
//   캠퍼스 한정 여부는 llm_classify(target_campuses)가 공지 내용으로 판단.
// 백필 2026-05-01. 인증: Bearer <CRON_SECRET>.

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_changup";
const BASE = "https://changup.cau.ac.kr";
const LIST_PATH = "/Notice_01";
const BACKFILL_FROM = "2026-05-01";

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [1_000, 3_000];
const POLITE_DELAY_MS = 300;

const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "Referer": "https://changup.cau.ac.kr/",
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

function webUrl(idx: string): string {
  return `${BASE}${LIST_PATH}/?bmode=view&idx=${idx}&t=board`;
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

type ListItem = { idx: string; title: string; date: string };

async function fetchListPage(page: number): Promise<ListItem[]> {
  const html = await fetchHtml(`${BASE}${LIST_PATH}?page=${page}`);
  const $ = load(html);
  const items: ListItem[] = [];
  const seen = new Set<string>();
  // 한 글 = ul.li_body.holder. (closest()/filter()/each-콜백 내 find()가 Deno cheerio에서
  // 불안정 → .eq(i) 인덱스 순회로 처리.)
  const holders = $("ul.li_body.holder");
  if (holders.length > 0) {
    const r0 = holders.eq(0);
    const h0 = r0.find("a[href*='idx=']").first().attr("href") ?? "(none)";
    const t0 = r0.find("li.tit").text().replace(/\s+/g, " ").trim();
    throw new Error(`DBG holders=${holders.length} href=${h0.slice(0, 45)} titlen=${t0.length} title=${t0.slice(0, 25)} date=${parseDate(r0.text())}`);
  }
  for (let i = 0; i < holders.length; i++) {
    const row = holders.eq(i);
    const href = row.find("a[href*='idx=']").first().attr("href") ?? "";
    const m = href.match(/[?&]idx=(\d+)/);
    if (!m || seen.has(m[1])) continue;
    // li.tit 전체 텍스트("공지사항 투자 세미나 안내")에서 맨 앞 카테고리 라벨(a._fade_link) 제거
    const titFull = row.find("li.tit").text().replace(/\s+/g, " ").trim();
    const cat = row.find("li.tit a._fade_link").text().replace(/\s+/g, " ").trim();
    const title = (cat && titFull.startsWith(cat)) ? titFull.slice(cat.length).trim() : titFull;
    const date = parseDate(row.text());
    if (title && date) { seen.add(m[1]); items.push({ idx: m[1], title, date }); }
  }
  return items;
}

async function fetchDetail(idx: string) {
  const html = await fetchHtml(webUrl(idx));
  const $ = load(html);
  // 본문: imweb 텍스트 위젯(.fr-view) 중 가장 내용이 많은 것을 본문으로
  let cont = $(".fr-view").first();
  let maxLen = 0;
  $(".fr-view").each((_, el) => {
    const len = $(el).text().trim().length;
    if (len > maxLen) { maxLen = len; cont = $(el); }
  });

  let bodyText = cont.text();
  bodyText = bodyText.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const images: string[] = [];
  cont.find("img").each((_, el) => {
    let src = $(el).attr("src") || $(el).attr("ec-data-src");
    if (!src) return;
    if (!/^https?:\/\//.test(src)) src = BASE + (src.startsWith("/") ? src : "/" + src);
    images.push(src);
  });

  const attachments: string[] = [];
  $("a[href*='/file/'], a[href*='download'], a[href*='filedown']").each((_, el) => {
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
        const url = webUrl(it.idx);
        try {
          const contentHash = await sha256Hex(`${it.title}|${url}|${postedAt}`);
          const { data: existing } = await supabase
            .from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
          if (existing) { stats.skippedDup++; continue; }

          const detail = await fetchDetail(it.idx);

          const { error: insErr } = await supabase.from("notices").insert({
            source_id: sourceId,
            source_category: null,
            title: it.title,
            body_text: detail.bodyText,
            body_image_urls: detail.images,
            attachment_urls: detail.attachments,
            source_url: url,
            author: "창업보육센터",
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
      if (page < pages) await sleep(1000);
    }

    // 새 글을 받으려다 전부 실패했으면(상세 주소가 바뀌는 등 사이트 개편) 성공으로 기록하지 않는다.
    // 성공으로 남기면 crawler_watch 가 몇 주 뒤 'quiet' 로나 알아챈다. 글 하나만 깨진 경우(1건)는 넘어간다.
    const allNewFailed = stats.fetchFailed >= 2 && stats.insertedNotices === 0;
    await supabase.from("crawler_health").upsert(allNewFailed
      ? {
        source_id: sourceId,
        last_attempt_at: new Date().toISOString(),
        last_error: `새 글 ${stats.fetchFailed}건 모두 수집 실패(사이트 구조 변경 의심)`,
      }
      : {
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
