// cau_artech — 예술공학대학(artech.cau.ac.kr) 뉴스 크롤러 (Next.js + GraphQL)
//
// 데이터: POST /api/graphql  newsListQuery(skip,take) → data.newsList[
//   { id, createdAt(ISO), isNotice, type, title, files{filesList:[{url,name}]}, content(HTML) } ]
//   본문(content HTML)이 함께 오므로 상세 조회 불필요. 이미지/첨부는 S3 절대 URL.
//
// 소속: 예술공학대학(arts_anseong 단과대, 안성캠). 인증: Bearer <CRON_SECRET>.

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_artech";
const BASE = "https://artech.cau.ac.kr";
const GQL = `${BASE}/api/graphql`;
const AUTHOR = "예술공학대학";
const DEFAULT_BACKFILL = "2026-05-01";

const NEWS_QUERY =
  "query newsListQuery($skip: Int, $take: Int) { newsList(skip: $skip, take: $take) { id createdAt isNotice type title files content } }";

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [1_000, 3_000];

const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Content-Type": "application/json",
  "Accept": "application/json",
  "Referer": `${BASE}/news`,
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

// ISO(UTC) → KST 날짜(YYYY-MM-DD)
function kstDate(iso: string): string | null {
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  return new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function fetchNews(take: number): Promise<any[]> {
  const body = JSON.stringify({ query: NEWS_QUERY, variables: { skip: 0, take } });
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(GQL, { method: "POST", headers: REQUEST_HEADERS, body, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j.errors) throw new Error(`GraphQL: ${JSON.stringify(j.errors).slice(0, 200)}`);
      return Array.isArray(j?.data?.newsList) ? j.data.newsList : [];
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

function parseContent(html: string) {
  const $ = load(`<div id="c">${html || ""}</div>`);
  const cont = $("#c");
  const bodyText = cont.text().replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const images: string[] = [];
  cont.find("img").each((_, el) => {
    let src = $(el).attr("src");
    if (!src || src.startsWith("data:")) return;
    if (src.startsWith("//")) src = "https:" + src;
    else if (!/^https?:\/\//.test(src)) src = BASE + (src.startsWith("/") ? src : "/" + src);
    images.push(src);
  });
  return { bodyText, images };
}

function extractFiles(files: any): string[] {
  const list = files?.filesList;
  if (!Array.isArray(list)) return [];
  return list.map((f: any) => f?.url).filter((u: any) => typeof u === "string" && /^https?:\/\//.test(u));
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const auth = req.headers.get("Authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let take = 40;
  let backfillFrom = DEFAULT_BACKFILL;
  try {
    const body = await req.json();
    if (body && Number.isInteger(body.take) && body.take > 0) take = Math.min(body.take, 200);
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
    const items = await fetchNews(take);
    stats.listed = items.length;

    for (const it of items) {
      const id = String(it.id ?? "");
      const title = String(it.title ?? "").replace(/\s+/g, " ").trim();
      const date = kstDate(String(it.createdAt ?? ""));
      if (!id || !title || !date) { stats.fetchFailed++; continue; }
      if (date < backfillFrom) { stats.skippedOld++; continue; }

      const postedAt = it.createdAt; // tz-aware ISO 그대로 저장
      const url = `${BASE}/news/${id}`;
      try {
        const contentHash = await sha256Hex(`${title}|${SOURCE_PARSER_KEY}/${id}|${date}`);
        const { data: existing } = await supabase
          .from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
        if (existing) { stats.skippedDup++; continue; }

        const { bodyText, images } = parseContent(it.content);
        const attachments = extractFiles(it.files);

        const { error: insErr } = await supabase.from("notices").insert({
          source_id: sourceId,
          source_category: null,
          title,
          body_text: bodyText,
          body_image_urls: images,
          attachment_urls: attachments,
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
        console.error(`item ${id}: ${(e as Error).message}`);
        stats.fetchFailed++;
      }
      await sleep(150);
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
