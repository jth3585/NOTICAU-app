// cau_chin — 중국어문학전공(ccll.cau.ac.kr) 공지 크롤러 (PHP 게시판, form POST)
//
// 목록: POST /dm/dm_1.php  body: code=b_1&p_page=N&p_mode=list&s_scroll=all&p_pgfile=/dm/dm_1.php
//        행: a[href="javascript:view('{id}')"](제목) + 날짜(YYYY.MM.DD)
// 상세: POST /dm/dm_1.php  body: code=b_1&p_idx={id}&p_mode=view&s_scroll=all&p_pgfile=/dm/dm_1.php
//        본문 #em_w_con1, 첨부 a.n_file2[href="javascript:download('{downpath}','{org}','{saved}')"]
//        → 첨부 직접 URL = BASE + downpath + '/' + saved
//
// 소속: 유럽문화학부 중국어문학전공(euro_german 단독). 인증: Bearer <CRON_SECRET>.

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_chin";
const BASE = "http://ccll.cau.ac.kr";
const BOARD_PATH = "/dm/dm_1.php";
const BOARD_CODE = "b_2";
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
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "Referer": `${BASE}${BOARD_PATH}`,
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

async function postBoard(params: Record<string, string>): Promise<string> {
  await sleep(POLITE_DELAY_MS);
  const body = new URLSearchParams({ code: BOARD_CODE, s_scroll: "all", p_pgfile: BOARD_PATH, ...params }).toString();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${BASE}${BOARD_PATH}`, { method: "POST", headers: REQUEST_HEADERS, body, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

type ListItem = { id: string; title: string; date: string };

function parseList(html: string): ListItem[] {
  const $ = load(html);
  const items: ListItem[] = [];
  const seen = new Set<string>();
  $("a[href*=\"view('\"]").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const m = href.match(/view\('(\d+)'\)/);
    if (!m || seen.has(m[1])) return;
    const title = $(a).text().replace(/\s+/g, " ").trim();
    if (!title) return;
    const date = parseDate($(a).closest("tr").text());
    if (!date) return;
    seen.add(m[1]);
    items.push({ id: m[1], title, date });
  });
  return items;
}

async function fetchDetail(id: string) {
  const html = await postBoard({ p_idx: id, p_mode: "view" });
  const $ = load(html);
  const cont = $("#em_w_con1").first();

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
  $("a.n_file2[href*='download(']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const m = href.match(/download\('([^']*)',\s*'[^']*',\s*'([^']*)'\)/);
    if (!m) return;
    const downpath = m[1].replace(/\/+$/, "");
    const saved = m[2];
    if (!downpath || !saved) return;
    const full = `${BASE}${downpath.startsWith("/") ? "" : "/"}${downpath}/${saved}`;
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
      const html = await postBoard({ p_page: String(page), p_mode: "list" });
      const rawItems = parseList(html);
      stats.listed += rawItems.length;
      if (rawItems.length === 0) break;

      for (const it of rawItems) {
        if (it.date < backfillFrom) { stats.skippedOld++; continue; }

        const postedAt = `${it.date}T00:00:00+09:00`;
        const url = `${BASE}${BOARD_PATH}?p_idx=${it.id}&p_mode=view`;
        try {
          const contentHash = await sha256Hex(`${it.title}|${SOURCE_PARSER_KEY}/${it.id}|${postedAt}`);
          const { data: existing } = await supabase
            .from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
          if (existing) { stats.skippedDup++; continue; }

          const detail = await fetchDetail(it.id);

          const { error: insErr } = await supabase.from("notices").insert({
            source_id: sourceId,
            source_category: SOURCE_CATEGORY,
            title: it.title,
            body_text: detail.bodyText,
            body_image_urls: detail.images,
            attachment_urls: detail.attachments,
            source_url: url,
            author: "중국어문학전공",
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
