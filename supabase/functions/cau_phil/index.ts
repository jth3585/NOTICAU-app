// cau_phil — 철학과(philosophy.cau.ac.kr) 공지 크롤러 (Next.js App Router + Supabase 백엔드)
//
// 목록: GET /notices → SSR 카드 a[href="/notices/{uuid}"] 안에 <h3>제목</h3> + 날짜(YYYY.MM.DD)
// 상세: GET /notices/{uuid} (헤더 RSC:1) → flight 페이로드의 최장 'T{hex},' 텍스트 청크에 본문 HTML.
//        첨부는 flight 내 supabase storage(post-attachments) URL.
//
// 소속: 철학과(philosophy 단독). 인증: Bearer <CRON_SECRET>.

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_phil";
const BASE = "https://philosophy.cau.ac.kr";
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
  "Referer": `${BASE}/notices`,
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

async function fetchText(url: string, extraHeaders?: Record<string, string>): Promise<string> {
  await sleep(POLITE_DELAY_MS);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { ...REQUEST_HEADERS, ...extraHeaders }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
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

type ListItem = { uuid: string; title: string; date: string };

function parseList(html: string): ListItem[] {
  const $ = load(html);
  const items: ListItem[] = [];
  const seen = new Set<string>();
  $("a[href*='/notices/']").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(/\/notices\/([0-9a-f-]{36})/i);
    if (!m || seen.has(m[1])) return;
    const h3 = $(a).find("h3").first();
    const title = (h3.length ? h3.text() : $(a).text()).replace(/\s+/g, " ").trim();
    if (!title) return;
    const date = parseDate($(a).text());
    if (!date) return;
    seen.add(m[1]);
    items.push({ uuid: m[1], title, date });
  });
  return items;
}

// React flight 페이로드에서 본문 추출: 'T{hexlen},' 텍스트 청크 중 가장 긴 것이 본문 HTML.
function extractFlightBody(flight: string): { html: string; attachments: string[] } {
  let bestHtml = "";
  const re = /[0-9a-f]+:T([0-9a-f]+),/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flight))) {
    const len = parseInt(m[1], 16);
    if (!Number.isFinite(len) || len < bestHtml.length) continue;
    const start = m.index + m[0].length;
    const chunk = flight.slice(start, start + len);
    if (/<(p|table|div|br|li|h\d)\b/i.test(chunk) && chunk.length > bestHtml.length) bestHtml = chunk;
  }
  const attachments = [...new Set(
    [...flight.matchAll(/https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/post-attachments\/[^\s"'\\)]+/gi)]
      .map((x) => x[0]),
  )];
  return { html: bestHtml, attachments };
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function fetchDetail(uuid: string) {
  const flight = await fetchText(`${BASE}/notices/${uuid}`, { "RSC": "1" });
  const { html, attachments } = extractFlightBody(flight);
  return { bodyText: htmlToText(html), attachments };
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const auth = req.headers.get("Authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let backfillFrom = DEFAULT_BACKFILL;
  try {
    const body = await req.json();
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
    const html = await fetchText(`${BASE}/notices`);
    const rawItems = parseList(html);
    stats.listed += rawItems.length;

    for (const it of rawItems) {
      if (it.date < backfillFrom) { stats.skippedOld++; continue; }

      const postedAt = `${it.date}T00:00:00+09:00`;
      const url = `${BASE}/notices/${it.uuid}`;
      try {
        const contentHash = await sha256Hex(`${it.title}|${SOURCE_PARSER_KEY}/${it.uuid}|${postedAt}`);
        const { data: existing } = await supabase
          .from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
        if (existing) { stats.skippedDup++; continue; }

        const detail = await fetchDetail(it.uuid);

        const { error: insErr } = await supabase.from("notices").insert({
          source_id: sourceId,
          source_category: SOURCE_CATEGORY,
          title: it.title,
          body_text: detail.bodyText,
          body_image_urls: [],
          attachment_urls: detail.attachments,
          source_url: url,
          author: "철학과",
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
        console.error(`item ${it.uuid}: ${(e as Error).message}`);
        stats.fetchFailed++;
      }
      await sleep(400);
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
