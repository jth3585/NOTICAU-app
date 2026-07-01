// cau_library — 학술정보원(서울, library.cau.ac.kr) 공지 크롤러 (v1.37, Phase 4)
//
// 사이트는 SPA지만 Pyxis 공개 JSON API로 데이터 제공 → API 직접 호출(HTML 스크래핑 X).
//   목록: /pyxis-api/1/bulletin-boards/1/bulletins?offset=N&max=M   (board 1 = "공지사항(서울)")
//   상세: /pyxis-api/1/bulletins/{id}  → data.content(HTML), data.attachments
//   웹(source_url): /community/bulletin/notice/{id}  (Pyxis 표준 경로)
//
// 설계: 크롤+notices INSERT만 (LLM은 별도 llm_classify). 인증: Bearer <CRON_SECRET>.
// content_hash = sha256(title|source_url|posted_at) — 기존 크롤러와 동일(dedup 호환).

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_library";
const BASE = "https://library.cau.ac.kr";
const BOARD_ID = 1; // 공지사항(서울)
const PAGE_SIZE = 20;

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [1_000, 3_000];
const POLITE_DELAY_MS = 300;

const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
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

// "2026-06-11 20:34:15" (KST) → "2026-06-11T20:34:15+09:00"
function toIso(dateCreated: string): string {
  const s = (dateCreated || "").trim().replace(" ", "T");
  return s ? `${s}+09:00` : "";
}

function webUrl(id: number | string): string {
  return `${BASE}/community/bulletin/notice/${id}`;
}

async function fetchJson(url: string): Promise<any> {
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
        console.warn(`[${SOURCE_PARSER_KEY}] fetch 실패 (${(err as Error).name}) → ${backoff}ms 후 재시도 ${attempt + 1}/${MAX_RETRIES}: ${url}`);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  }
  throw lastErr;
}

type ListItem = {
  id: number;
  title: string;
  writer: string | null;
  dateCreated: string;
  category: string | null;
};

// 목록 한 페이지 (offset 기반)
async function fetchListPage(page: number): Promise<ListItem[]> {
  const offset = (page - 1) * PAGE_SIZE;
  const json = await fetchJson(`${BASE}/pyxis-api/1/bulletin-boards/${BOARD_ID}/bulletins?offset=${offset}&max=${PAGE_SIZE}`);
  const list = json?.data?.list;
  if (!Array.isArray(list)) return [];
  return list.map((it: any): ListItem => ({
    id: it.id,
    title: (it.title ?? "").trim(),
    writer: it.writer ?? null,
    dateCreated: it.dateCreated ?? "",
    category: it.bulletinCategory?.name ?? null,
  })).filter((it) => it.id != null && it.title);
}

// 상세 (본문 HTML → 텍스트/이미지, 첨부)
async function fetchDetail(id: number) {
  const json = await fetchJson(`${BASE}/pyxis-api/1/bulletins/${id}`);
  const d = json?.data ?? {};
  const contentHtml: string = d.content ?? "";

  const $ = load(contentHtml);
  let bodyText = $("body").text();
  bodyText = bodyText.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const images: string[] = [];
  $("img").each((_, el) => {
    let src = $(el).attr("src");
    if (!src || src.startsWith("data:")) return;
    if (!/^https?:\/\//.test(src)) src = BASE + (src.startsWith("/") ? src : "/" + src);
    images.push(src);
  });

  const attachments: string[] = [];
  if (Array.isArray(d.attachments)) {
    for (const a of d.attachments) {
      const path = a?.originalImageUrl;
      if (typeof path === "string" && path) {
        attachments.push(/^https?:\/\//.test(path) ? path : BASE + (path.startsWith("/") ? path : "/" + path));
      }
    }
  }

  return { bodyText, images, attachments };
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
        const postedAt = toIso(it.dateCreated);
        const url = webUrl(it.id);
        try {
          const contentHash = await sha256Hex(`${it.title}|${url}|${postedAt}`);
          const { data: existing } = await supabase
            .from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
          if (existing) { stats.skippedDup++; continue; }

          const detail = await fetchDetail(it.id);

          const { error: insErr } = await supabase.from("notices").insert({
            source_id: sourceId,
            source_category: it.category,
            title: it.title,
            body_text: detail.bodyText,
            body_image_urls: detail.images,
            attachment_urls: detail.attachments,
            source_url: url,
            author: it.writer || "학술정보원",
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
