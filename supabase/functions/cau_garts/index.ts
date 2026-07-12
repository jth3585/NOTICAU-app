// cau_garts — 예술대학 글로벌예술학부(globalarts.cau.ac.kr) 공지 크롤러 (CAU cm/dm 계열 CMS)
//
// 목록: GET /dm/dm_2.php?p_page=N → tr 내 view('idx')(href/onclick 혼용, 제목) + 날짜(YYYY.MM.DD)
// 상세: GET /dm/dm_2.php?p_idx={idx}&p_mode=view → 본문 [id$="_w_con1"]
//        (view() JS가 board_frm을 method=get으로 바꿔 제출하므로 GET로 접근)
//        첨부: onclick file_down('key') → /ModulePrint/ModuleInclude/filedown.php?p_key=key
//
// 소속: 예술대학 글로벌예술학부(global_arts 단독, 안성). 인증: Bearer <CRON_SECRET>.

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_garts";
const BASE = "https://globalarts.cau.ac.kr";
const LIST_PATH = "/dm/dm_2.php";
const BODY_SEL = "[id$='_w_con1']";
const AUTHOR = "글로벌예술학부";
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

// YYYY.MM.DD / YY.MM.DD / YYYY-MM-DD → YYYY-MM-DD
function parseDate(raw: string): string | null {
  const m = (raw || "").match(/(\d{2,4})[.\-](\d{2})[.\-](\d{2})/);
  if (!m) return null;
  const y = m[1].length === 2 ? `20${m[1]}` : m[1];
  return `${y}-${m[2]}-${m[3]}`;
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

function viewUrl(idx: string): string {
  return `${BASE}${LIST_PATH}?p_idx=${idx}&p_mode=view`;
}

type ListItem = { idx: string; title: string; date: string };

function parseList(html: string): ListItem[] {
  const $ = load(html);
  const items: ListItem[] = [];
  const seen = new Set<string>();
  // 목록 항목은 사이트마다 href="javascript:view('..')" 또는 onclick="..view('..').." 혼용
  $("a[href*=\"view('\"], [onclick*=\"view('\"]").each((_, el) => {
    const oc = `${$(el).attr("onclick") ?? ""} ${$(el).attr("href") ?? ""}`;
    const m = oc.match(/view\('(\d+)'/);
    if (!m || seen.has(m[1])) return;
    const title = $(el).text().replace(/\s+/g, " ").trim();
    if (!title || title.length < 2) return;
    const row = $(el).closest("tr");
    const date = parseDate(row.length ? row.text() : $(el).parent().text());
    if (!date) return;
    seen.add(m[1]);
    items.push({ idx: m[1], title, date });
  });
  return items;
}

async function fetchDetail(idx: string) {
  const html = await fetchHtml(viewUrl(idx));
  const $ = load(html);
  const cont = $(BODY_SEL).first();

  const bodyText = cont.text().replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const images: string[] = [];
  cont.find("img").each((_, el) => {
    let src = $(el).attr("src");
    if (!src || src.startsWith("data:")) return;
    if (src.startsWith("//")) src = "https:" + src;
    else if (src.startsWith("/")) src = BASE + src;
    else if (!/^https?:\/\//.test(src)) src = `${BASE}/${src}`;
    images.push(src);
  });

  // 첨부: file_down('key') → filedown.php?p_key=key
  const attachments: string[] = [];
  const dlRe = /file_down\('([^']+)'\)/g;
  let dm: RegExpExecArray | null;
  while ((dm = dlRe.exec(html)) !== null) {
    const url = `${BASE}/ModulePrint/ModuleInclude/filedown.php?p_key=${dm[1]}`;
    if (!attachments.includes(url)) attachments.push(url);
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
      const html = await fetchHtml(`${BASE}${LIST_PATH}?p_page=${page}`);
      const rawItems = parseList(html);
      stats.listed += rawItems.length;
      if (rawItems.length === 0) break;

      for (const it of rawItems) {
        if (it.date < backfillFrom) { stats.skippedOld++; continue; }

        const postedAt = `${it.date}T00:00:00+09:00`;
        const url = viewUrl(it.idx);
        try {
          const contentHash = await sha256Hex(`${it.title}|${SOURCE_PARSER_KEY}/${it.idx}|${postedAt}`);
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
