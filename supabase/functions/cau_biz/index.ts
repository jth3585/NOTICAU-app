// cau_biz — 경영학부(biz.cau.ac.kr) 공지 크롤러 (GitHub Actions → Edge Function 이관, v1.30)
//
// 목록: /2016/sub06/sub06_01_list.php?gotoPage=N   상세: /2016/sub06/sub06_01_view.php?bbsIdx=NNNN
//
// cau_bne와 동일 구조. 차이: 경로/파라미터, 4컴럼 목록, 분류 컴럼 없음(rawCategory=null),
// 첨부 file_down.php(용량표기 제거), 본문 .text_wrap, UI 이미지 /2016/images/ 제외.
// content_hash = sha256(listTitle|absUrl|posted_at) — Node 크롤러와 동일 (dedup 연속).

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_biz";
const BASE = "https://biz.cau.ac.kr";
const LIST_PATH = "/2016/sub06/sub06_01_list.php";
const VIEW_PATH = "/2016/sub06/sub06_01_view.php";
const PAGE_PARAM = "gotoPage";
const ID_PARAM = "bbsIdx";

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [1_000, 3_000];
const POLITE_DELAY_MS = 500;

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

function absUrl(href: string | undefined): string | null {
  if (!href) return null;
  if (/^https?:\/\//.test(href)) return href;
  if (href.startsWith("/")) return BASE + href;
  const listDir = LIST_PATH.replace(/[^/]+$/, "");
  return BASE + listDir + href;
}

async function fetchPage(url: string): Promise<string> {
  await sleep(POLITE_DELAY_MS);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        const backoff = RETRY_BACKOFF_MS[attempt] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
        console.warn(`[${SOURCE_PARSER_KEY}] fetch 실패 (${(err as Error).name}: ${(err as Error).message}) → ${backoff}ms 후 재시도 ${attempt + 1}/${MAX_RETRIES}: ${url}`);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  }
  throw lastErr;
}

// 목록 파싱 — biz 어댑터 (.board_list table tbody tr, 4컴럼)
async function fetchListPage(pageNum: number) {
  const html = await fetchPage(`${BASE}${LIST_PATH}?${PAGE_PARAM}=${pageNum}`);
  const $ = load(html);
  const items: { externalId: string; title: string; url: string; rawCategory: string | null; publishedAt: string; isPinned: boolean }[] = [];
  $(".board_list table tbody tr").each((_, el) => {
    const $row = $(el);
    const tds = $row.find("td");
    if (tds.length !== 4) return;
    const $titleA = $(tds[1]).find("a").first();
    const title = $titleA.text().trim();
    const href = $titleA.attr("href") || "";
    if (!title || !href) return;
    const m = href.match(/[?&]bbsIdx=(\d+)/);
    if (!m) return;
    const dateText = $(tds[3]).find(".date").first().text().trim();
    const dm = dateText.match(/(\d{4})\.(\d{2})\.(\d{2})/);
    if (!dm) return;
    const isPinned = $row.hasClass("notice") || $(tds[0]).find("img[src*='ico_notice']").length > 0;
    const url = /^https?:/.test(href) ? href : absUrl(href)!;
    items.push({
      externalId: m[1],
      title,
      url,
      rawCategory: null,
      publishedAt: `${dm[1]}-${dm[2]}-${dm[3]}`,
      isPinned,
    });
  });
  return items;
}

// 상세 파싱 — biz 어댑터
async function fetchDetail(externalId: string) {
  const html = await fetchPage(`${BASE}${VIEW_PATH}?${ID_PARAM}=${externalId}`);
  const $ = load(html);
  const $bw = $(".board_write");

  const fullTitle = $bw.find(".txt").first().text().trim();

  const attachments: { name: string; url: string }[] = [];
  $bw.find('.inp_wrap a[href*="file_down.php"]').each((_, el) => {
    const $a = $(el);
    const url = $a.attr("href");
    const name = $a.text().trim().replace(/\s*\(\s*[\d.,]+\s*[KMGT]?B\s*\)\s*$/i, "").trim();
    if (url && name) attachments.push({ name, url: /^https?:/.test(url) ? url : absUrl(url)! });
  });

  const $body = $bw.find(".text_wrap").first();
  let bodyText = ($body.text() || "").replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const images: string[] = [];
  $body.find("img").each((_, el) => {
    let src = $(el).attr("src");
    if (!src) return;
    if (src.includes("/2016/images/")) return;
    if (!/^https?:\/\//.test(src)) src = BASE + (src.startsWith("/") ? src : "/" + src);
    images.push(src);
  });

  return { fullTitle, author: null as string | null, bodyText, attachments, images };
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const auth = req.headers.get("Authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let pages = 1;
  try {
    const body = await req.json();
    if (body && Number.isInteger(body.pages) && body.pages > 0) pages = Math.min(body.pages, 30);
  } catch { /* cron 빈 body */ }

  const { data: source, error: sErr } = await supabase
    .from("sources").select("id").eq("parser_key", SOURCE_PARSER_KEY).single();
  if (sErr || !source) {
    return new Response(JSON.stringify({ error: `source not found: ${SOURCE_PARSER_KEY}` }), { status: 500 });
  }
  const sourceId = source.id;

  const stats = { pages: 0, listed: 0, skippedDup: 0, insertedNotices: 0, fetchFailed: 0 };

  try {
    for (let page = 1; page <= pages; page++) {
      const rawItems = await fetchListPage(page);
      stats.listed += rawItems.length;
      stats.pages++;
      if (rawItems.length === 0) break;

      for (const it of rawItems) {
        const postedAt = `${it.publishedAt}T00:00:00+09:00`;
        try {
          const contentHash = await sha256Hex(`${it.title}|${it.url}|${postedAt}`);
          const { data: existing } = await supabase
            .from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
          if (existing) { stats.skippedDup++; continue; }

          const detail = await fetchDetail(it.externalId);
          const finalTitle = detail.fullTitle && detail.fullTitle.length > it.title.length ? detail.fullTitle : it.title;

          const { error: insErr } = await supabase.from("notices").insert({
            source_id: sourceId,
            source_category: it.rawCategory,
            title: finalTitle,
            body_text: detail.bodyText,
            body_image_urls: detail.images,
            attachment_urls: detail.attachments.map((a) => a.url),
            source_url: it.url,
            author: detail.author || "관리자",
            posted_at: postedAt,
            is_pinned: it.isPinned,
            content_hash: contentHash,
          });
          if (insErr) {
            if (insErr.code === "23505") { stats.skippedDup++; continue; }
            throw insErr;
          }
          stats.insertedNotices++;
        } catch (e) {
          console.error(`item ${it.externalId}: ${(e as Error).message}`);
          stats.fetchFailed++;
        }
        await sleep(2000);
      }
      if (page < pages) await sleep(3000);
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
