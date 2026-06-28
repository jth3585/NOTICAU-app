// cau_jpn — 일본어문학전공(caujapanese.kr) 공지 크롤러 (imweb 빌더 게시판)
//
// 목록: GET /notice/?page=N → a[href*="bmode=view"](제목, idx). 목록 날짜는 사전 스킵용.
// 상세: GET /notice/?bmode=view&idx={idx}&t=board → 본문 .board_txt_area, 게시일은 post_code의
//        'p{YYYYMMDD}'에서 추출(권위 날짜).
//
// 소속: 아시아문화학부 일본어문학전공(asia_japanese 단독). 인증: Bearer <CRON_SECRET>.

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_jpn";
const BASE = "https://caujapanese.kr";
const LIST_PATH = "/notice/";
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

const DATE_RE = /(\d{4})-(\d{2})-(\d{2})/;

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

function viewUrl(idx: string): string {
  return `${BASE}${LIST_PATH}?bmode=view&idx=${idx}&t=board`;
}

type ListItem = { idx: string; title: string; listDate: string | null };

function parseList(html: string): ListItem[] {
  const $ = load(html);
  const items: ListItem[] = [];
  const seen = new Set<string>();
  $('a[href*="bmode=view"]').each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(/idx=(\d+)/);
    if (!m || seen.has(m[1])) return;
    const idx = m[1];
    const title = $(a).text().replace(/\s+/g, " ").trim();
    if (!title) return;
    // 목록 날짜: 같은 idx 앵커만 든 조상까지 올라가 날짜 탐색(사전 스킵용, 없으면 null)
    let node = $(a);
    let listDate: string | null = null;
    for (let i = 0; i < 7; i++) {
      const up = node.parent();
      if (!up.length) break;
      const ids = new Set(
        up.find('a[href*="bmode=view"]').map((_, x) => (($(x).attr("href") ?? "").match(/idx=(\d+)/) ?? [])[1]).get(),
      );
      if (ids.size > 1) break;
      node = up;
      const dm = node.text().match(DATE_RE);
      if (dm) listDate = `${dm[1]}-${dm[2]}-${dm[3]}`;
    }
    seen.add(idx);
    items.push({ idx, title, listDate });
  });
  return items;
}

async function fetchDetail(idx: string) {
  const html = await fetchHtml(viewUrl(idx));
  const $ = load(html);
  const cont = $(".board_txt_area").first();

  let bodyText = cont.text().replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const images: string[] = [];
  cont.find("img").each((_, el) => {
    let src = $(el).attr("src");
    if (!src) return;
    if (src.startsWith("//")) src = "https:" + src;
    else if (!/^https?:\/\//.test(src)) src = BASE + (src.startsWith("/") ? src : "/" + src);
    images.push(src);
  });

  // 권위 게시일: post_code 'p{YYYYMMDD}'
  const pm = html.match(/post_code"\s*:\s*"p(\d{4})(\d{2})(\d{2})/);
  const date = pm ? `${pm[1]}-${pm[2]}-${pm[3]}` : null;

  return { bodyText, images, date };
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
      const html = await fetchHtml(`${BASE}${LIST_PATH}?page=${page}`);
      const rawItems = parseList(html);
      stats.listed += rawItems.length;
      if (rawItems.length === 0) break;

      for (const it of rawItems) {
        // 목록 날짜가 있고 컷오프보다 과거면 상세 조회 없이 스킵
        if (it.listDate && it.listDate < backfillFrom) { stats.skippedOld++; continue; }

        const url = viewUrl(it.idx);
        try {
          // 임시 해시(목록 날짜 기준) 선조회로 중복이면 상세 생략
          if (it.listDate) {
            const preHash = await sha256Hex(`${it.title}|${SOURCE_PARSER_KEY}/${it.idx}|${it.listDate}T00:00:00+09:00`);
            const { data: ex } = await supabase.from("notices").select("id").eq("content_hash", preHash).maybeSingle();
            if (ex) { stats.skippedDup++; continue; }
          }

          const detail = await fetchDetail(it.idx);
          const date = detail.date ?? it.listDate;
          if (!date) { stats.fetchFailed++; continue; }
          if (date < backfillFrom) { stats.skippedOld++; continue; }

          const postedAt = `${date}T00:00:00+09:00`;
          const contentHash = await sha256Hex(`${it.title}|${SOURCE_PARSER_KEY}/${it.idx}|${postedAt}`);
          const { data: existing } = await supabase
            .from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
          if (existing) { stats.skippedDup++; continue; }

          const { error: insErr } = await supabase.from("notices").insert({
            source_id: sourceId,
            source_category: SOURCE_CATEGORY,
            title: it.title,
            body_text: detail.bodyText,
            body_image_urls: detail.images,
            attachment_urls: [],
            source_url: url,
            author: "일본어문학전공",
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
