// cau_dorm — 생활관 공지 크롤러 (서울 + 다빈치, v1.38 Phase 4)
//
// 두 생활관이 동일 CMS(PHP HTML) → 한 함수에서 두 보드를 각자 소스로 분리 적재.
//   서울:   dormitory.cau.ac.kr  /community.php?mid=m05_01_01  (parser_key cau_dorm_seoul, campus seoul)
//   다빈치: dorm.cau.ac.kr       /community.php?mid=m06_01     (parser_key cau_dorm, campus anseong)
//   목록 table#Board → td.Subject a(제목), span(카테고리), td.board_date(YYYY-MM-DD), act=view&uid=N
//   상세 #BoardContent(본문), 첨부 a[href*="downloadfile.php"], 작성자 표기 없음 → "생활관".
//   인라인 이미지는 data:base64라 http 이미지만 저장.
//
// 인증: Bearer <CRON_SECRET>. content_hash = sha256(title|source_url|posted_at) (기존 호환).

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

type Board = { parserKey: string; base: string; mid: string };
const BOARDS: Board[] = [
  { parserKey: "cau_dorm_seoul", base: "https://dormitory.cau.ac.kr", mid: "m05_01_01" },
  { parserKey: "cau_dorm", base: "https://dorm.cau.ac.kr", mid: "m06_01" },
];

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [1_000, 3_000];
const POLITE_DELAY_MS = 500;
const BUCKET = "crawled-images";
const MAX_IMG_B64 = 7_000_000; // base64 길이 상한(≈5MB 바이너리) — 초과 시 업로드 스킵

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

function listUrl(b: Board, page: number): string {
  return page <= 1 ? `${b.base}/community.php?mid=${b.mid}` : `${b.base}/community.php?mid=${b.mid}&page=${page}`;
}
function viewUrl(b: Board, uid: string): string {
  return `${b.base}/community.php?mid=${b.mid}&act=view&uid=${uid}`;
}

async function fetchPage(url: string): Promise<string> {
  await sleep(POLITE_DELAY_MS);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      // 서울 생활관은 첫 요청에 302(/start.php)+세션쿠키를 주지만 302 본문에 실제 게시판이 들어있음.
      // redirect를 따라가면 인트로로 빠지므로 manual로 받아 본문을 그대로 읽는다. (다빈치는 200이라 무관)
      res = await fetch(url, { headers: REQUEST_HEADERS, redirect: "manual", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        const backoff = RETRY_BACKOFF_MS[attempt] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
        await sleep(backoff);
        continue;
      }
      throw err;
    }
    if (res.status >= 400) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  }
  throw lastErr;
}

type ListItem = { uid: string; title: string; category: string | null; publishedAt: string };

async function fetchListPage(b: Board, page: number): Promise<ListItem[]> {
  const html = await fetchPage(listUrl(b, page));
  const $ = load(html);
  const items: ListItem[] = [];
  $("table#Board tr").each((_, el) => {
    const $row = $(el);
    const $a = $row.find("td.Subject a").first();
    const href = $a.attr("href") || "";
    const title = $a.text().trim();
    const m = href.match(/[?&]uid=(\d+)/);
    if (!title || !m) return;
    let category = $row.find("td.Subject span").first().text().trim() || null;
    if (category) category = category.replace(/^\[|\]$/g, "").trim() || null;
    const dateText = $row.find("td.board_date").first().text().trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return;
    items.push({ uid: m[1], title, category, publishedAt: dateText });
  });
  return items;
}

async function fetchDetail(b: Board, uid: string) {
  const html = await fetchPage(viewUrl(b, uid));
  const $ = load(html);

  const $body = $("#BoardContent");
  let bodyText = $body.text();
  bodyText = bodyText.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const images: string[] = [];
  let firstData: { mime: string; ext: string; b64: string } | null = null;
  $body.find("img").each((_, el) => {
    const src = $(el).attr("src") || "";
    if (/^https?:\/\//.test(src)) { images.push(src); return; } // 절대 http (드묾)
    if (src.startsWith("/")) { images.push(b.base + src); return; } // 상대 서버경로 (서울 /upload/image/*)
    if (!firstData) { // data:base64 인라인 (다빈치 포스터) — 첫 장만 업로드 대상
      const m = src.match(/^data:(image\/(png|jpe?g|gif|webp));base64,(.+)$/i);
      if (m) firstData = { mime: m[1], ext: m[2].toLowerCase().replace("jpeg", "jpg"), b64: m[3] };
    }
  });
  // http 이미지가 없고 base64 포스터만 있으면, 첫 장만 Storage에 올려 URL화
  // (분류기 비전 경로 + 앱 상세 이미지 표시용). 실패 시 텍스트 fallback.
  if (images.length === 0 && firstData && firstData.b64.length <= MAX_IMG_B64) {
    try {
      const bytes = Uint8Array.from(atob(firstData.b64), (c) => c.charCodeAt(0));
      const hash = await sha256Hex(firstData.b64);
      const path = `${b.parserKey}/${hash}.${firstData.ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: firstData.mime, upsert: true });
      if (!upErr) {
        const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
        if (data?.publicUrl) images.push(data.publicUrl);
      }
    } catch (_) { /* 업로드 실패 무시 */ }
  }

  const attachments: string[] = [];
  $('a[href*="downloadfile.php"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    attachments.push(/^https?:\/\//.test(href) ? href : b.base + (href.startsWith("/") ? href : "/" + href));
  });

  return { bodyText, images, attachments };
}

async function crawlBoard(b: Board, pages: number, reprocess: boolean) {
  const stat = { board: b.parserKey, pages: 0, listed: 0, skippedDup: 0, insertedNotices: 0, updated: 0, fetchFailed: 0, error: null as string | null };

  const { data: source } = await supabase.from("sources").select("id").eq("parser_key", b.parserKey).maybeSingle();
  if (!source) { stat.error = `source not found: ${b.parserKey}`; return stat; }
  const sourceId = source.id;

  try {
    for (let page = 1; page <= pages; page++) {
      const rawItems = await fetchListPage(b, page);
      stat.listed += rawItems.length;
      stat.pages++;
      if (rawItems.length === 0) break;

      for (const it of rawItems) {
        const postedAt = `${it.publishedAt}T00:00:00+09:00`;
        const url = viewUrl(b, it.uid);
        try {
          const contentHash = await sha256Hex(`${it.title}|${url}|${postedAt}`);
          const { data: existing } = await supabase.from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
          if (existing && !reprocess) { stat.skippedDup++; continue; }

          const detail = await fetchDetail(b, it.uid);

          // reprocess: 기존 행의 본문/이미지/첨부만 in-place 갱신 (삭제 없이 백필)
          if (existing) {
            await supabase.from("notices").update({
              body_text: detail.bodyText,
              body_image_urls: detail.images,
              attachment_urls: detail.attachments,
            }).eq("id", existing.id);
            stat.updated++;
            await sleep(1500);
            continue;
          }

          const { error: insErr } = await supabase.from("notices").insert({
            source_id: sourceId,
            source_category: it.category,
            title: it.title,
            body_text: detail.bodyText,
            body_image_urls: detail.images,
            attachment_urls: detail.attachments,
            source_url: url,
            author: "생활관",
            posted_at: postedAt,
            is_pinned: false,
            content_hash: contentHash,
          });
          if (insErr) {
            if (insErr.code === "23505") { stat.skippedDup++; continue; }
            throw insErr;
          }
          stat.insertedNotices++;
        } catch (e) {
          console.error(`[${b.parserKey}] item ${it.uid}: ${(e as Error).message}`);
          stat.fetchFailed++;
        }
        await sleep(1500);
      }
      if (page < pages) await sleep(3000);
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
    stat.error = String(e).slice(0, 300);
    await supabase.from("crawler_health").upsert({
      source_id: sourceId,
      last_attempt_at: new Date().toISOString(),
      last_error: String(e).slice(0, 500),
    });
  }
  return stat;
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const auth = req.headers.get("Authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let pages = 1;
  let reprocess = false;
  try {
    const body = await req.json();
    if (body && Number.isInteger(body.pages) && body.pages > 0) pages = Math.min(body.pages, 30);
    if (body && body.reprocess === true) reprocess = true;
  } catch { /* cron 빈 body */ }

  const results = [];
  for (const b of BOARDS) {
    results.push(await crawlBoard(b, pages, reprocess));
  }

  return new Response(JSON.stringify({ results }), { headers: { "Content-Type": "application/json" } });
});
