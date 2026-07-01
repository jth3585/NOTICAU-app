// cau_socio — 사회학과(sociology.cau.ac.kr) 공지 크롤러 (M15 CMS, GET)
//
// 게시판 2개: /dm/dm-1.php(PageId 1730420830), /dm/dm-2.php(PageId 1730420840), code=M15
// 목록: GET {board}?code=M15&PageId={pid}&p_mode=list&p_page=N
//        a[href="javascript:view('{idx}','?',...)"](제목) + 날짜(YYYY.MM.DD)
// 상세: GET {board}?code=M15&PageId={pid}&p_mode=view&p_idx={idx} → 본문 .bo-cont
//
// 소속: 사회학과(sociology 단독). 인증: Bearer <CRON_SECRET>.

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_socio";
const BASE = "https://sociology.cau.ac.kr";
const CODE = "M15";
// [board path, PageId, source_category]
const BOARDS: [string, string, string | null][] = [
  ["/dm/dm-1.php", "1730420830", null],
  ["/dm/dm-2.php", "1730420840", null],
];
const DEFAULT_BACKFILL = "2026-05-01";

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = [1_000, 3_000];
const POLITE_DELAY_MS = 300;

const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "Referer": `${BASE}/`,
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

function listUrl(board: string, pid: string, page: number): string {
  return `${BASE}${board}?code=${CODE}&PageId=${pid}&p_mode=list&p_page=${page}`;
}
function viewUrl(board: string, pid: string, idx: string): string {
  return `${BASE}${board}?code=${CODE}&PageId=${pid}&p_mode=view&p_idx=${idx}`;
}

type ListItem = { idx: string; title: string; date: string };

function parseList(html: string): ListItem[] {
  const $ = load(html);
  const items: ListItem[] = [];
  const seen = new Set<string>();
  $("a[href*=\"view('\"]").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(/view\('(\d+)'/);
    if (!m || seen.has(m[1])) return;
    const title = $(a).text().replace(/\s+/g, " ").trim();
    if (!title) return;
    const date = parseDate($(a).closest("tr").text());
    if (!date) return;
    seen.add(m[1]);
    items.push({ idx: m[1], title, date });
  });
  return items;
}

async function fetchDetail(board: string, pid: string, idx: string) {
  const html = await fetchHtml(viewUrl(board, pid, idx));
  const $ = load(html);
  const cont = $(".bo-cont").first();

  let bodyText = cont.text().replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

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

  const stats = { boards: 0, listed: 0, skippedOld: 0, skippedDup: 0, insertedNotices: 0, fetchFailed: 0 };

  try {
    for (const [board, pid, category] of BOARDS) {
      stats.boards++;
      for (let page = 1; page <= pages; page++) {
        const html = await fetchHtml(listUrl(board, pid, page));
        const rawItems = parseList(html);
        stats.listed += rawItems.length;
        if (rawItems.length === 0) break;

        for (const it of rawItems) {
          if (it.date < backfillFrom) { stats.skippedOld++; continue; }

          const postedAt = `${it.date}T00:00:00+09:00`;
          const url = viewUrl(board, pid, it.idx);
          try {
            const contentHash = await sha256Hex(`${it.title}|${SOURCE_PARSER_KEY}${board}/${it.idx}|${postedAt}`);
            const { data: existing } = await supabase
              .from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
            if (existing) { stats.skippedDup++; continue; }

            const detail = await fetchDetail(board, pid, it.idx);

            const { error: insErr } = await supabase.from("notices").insert({
              source_id: sourceId,
              source_category: category,
              title: it.title,
              body_text: detail.bodyText,
              body_image_urls: detail.images,
              attachment_urls: [],
              source_url: url,
              author: "사회학과",
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
            console.error(`item ${board}/${it.idx}: ${(e as Error).message}`);
            stats.fetchFailed++;
          }
          await sleep(400);
        }
        if (page < pages) await sleep(800);
      }
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
