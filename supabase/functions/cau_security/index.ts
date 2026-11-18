// cau_security — 산업보안학과(security.cau.ac.kr) 공지 크롤러 (gnuboard, 2026-09 사이트 개편 후)
//
// 2026-09 개편으로 옛 게시판(board.htm?bbsid=notice, EUC-KR)이 404 → 8/31 이후 수집이 끊겼다(2026-11-18 발견).
// 새 사이트는 gnuboard 이고 게시판이 여러 개다:
//   sub5_1 공지 & 안내 / sub5_3 세미나 & 행사 / sub5_4 취업 정보(source_category "취업/공모")
//   (sub5_2 연구 활동은 연구실 소식이라 제외)
// 목록: GET /bbs/board.php?bo_table={BO}&page=N → tr 마다 .bo_tit a[href*="wr_id="](제목) + td.td_datetime(YYYY-MM-DD)
//   상단 고정공지(tr.bo_notice)가 많아 일반 글이 밀리므로 cron 은 pages=2 로 돈다.
// 상세: GET /bbs/board.php?bo_table={BO}&wr_id={id} → #bo_v_con(본문), #bo_v_img(첨부 이미지), download.php(첨부)
//
// 옛 사이트 글(~8/31)은 이미 들어와 있어 백필은 9/1 부터(같은 글이 새 주소로 중복 수집되지 않게).
// 인증: Bearer <CRON_SECRET>.

import { load } from "npm:cheerio";
// 2.119.1 이 npm 의존성(storage-js) 배포 전에 JSR 에 올라와 번들이 실패해서 고정(2026-11-18).
import { createClient } from "jsr:@supabase/supabase-js@2.119.0";

const SOURCE_PARSER_KEY = "cau_security";
const BASE = "https://security.cau.ac.kr";
const AUTHOR = "산업보안학과";
const DEFAULT_BACKFILL = "2026-09-01";
// [bo_table, source_category]
const BOARDS: [string, string | null][] = [
  ["sub5_1", null],
  ["sub5_3", null],
  ["sub5_4", "취업/공모"],
];

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

function abs(href: string): string {
  const h = href.replace(/&amp;/g, "&");
  if (/^https?:\/\//.test(h)) return h;
  if (h.startsWith("//")) return "https:" + h;
  if (h.startsWith("/")) return BASE + h;
  return `${BASE}/bbs/${h.replace(/^\.\//, "")}`;
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

function viewUrl(bo: string, id: string): string {
  return `${BASE}/bbs/board.php?bo_table=${bo}&wr_id=${id}`;
}

type ListItem = { id: string; title: string; date: string };

function parseList(html: string): ListItem[] {
  const $ = load(html);
  const items: ListItem[] = [];
  const seen = new Set<string>();
  $("tbody tr").each((_, tr) => {
    const a = $(tr).find(".bo_tit a[href*='wr_id=']").first();
    const m = (a.attr("href") ?? "").match(/wr_id=(\d+)/);
    if (!m || seen.has(m[1])) return;
    const title = a.text().replace(/\s+/g, " ").trim();
    const d = ($(tr).find("td.td_datetime").first().text() || $(tr).find(".date").first().text())
      .match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!title || !d) return;
    seen.add(m[1]);
    items.push({ id: m[1], title, date: `${d[1]}-${d[2]}-${d[3]}` });
  });
  return items;
}

async function fetchDetail(bo: string, id: string) {
  const html = await fetchHtml(viewUrl(bo, id));
  const $ = load(html);
  const cont = $("#bo_v_con").first();
  const bodyText = cont.text().replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  const images: string[] = [];
  const addImg = (src: string | undefined) => {
    if (!src || src.startsWith("data:")) return;
    // 썸네일(thumb-이름_600x849.png) → 원본(이름.png)
    const full = abs(src).replace(/\/thumb-([^/]+?)_\d+x\d+(\.\w+)$/, "/$1$2");
    if (!images.includes(full)) images.push(full);
  };
  cont.find("img").each((_, el) => addImg($(el).attr("src")));
  // 첨부로 올린 이미지는 본문 칸 밖(#bo_v_img)에 나온다. 행사 포스터가 대개 여기에 있다.
  $("#bo_v_img img").each((_, el) => addImg($(el).attr("src")));

  const attachments: string[] = [];
  $("a[href*='download.php']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!href || href.startsWith("javascript")) return;
    const full = abs(href);
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

  let pages = 2;
  let backfillFrom = DEFAULT_BACKFILL;
  try {
    const body = await req.json();
    if (body && Number.isInteger(body.pages) && body.pages > 0) pages = Math.min(body.pages, 20);
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
    for (const [bo, category] of BOARDS) {
      stats.boards++;
      for (let page = 1; page <= pages; page++) {
        const rawItems = parseList(await fetchHtml(`${BASE}/bbs/board.php?bo_table=${bo}&page=${page}`));
        stats.listed += rawItems.length;
        if (rawItems.length === 0) break;

        for (const it of rawItems) {
          if (it.date < backfillFrom) { stats.skippedOld++; continue; }
          const postedAt = `${it.date}T00:00:00+09:00`;
          const url = viewUrl(bo, it.id);
          try {
            const contentHash = await sha256Hex(`${it.title}|${SOURCE_PARSER_KEY}/${bo}/${it.id}|${postedAt}`);
            const { data: existing } = await supabase
              .from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
            if (existing) { stats.skippedDup++; continue; }

            const detail = await fetchDetail(bo, it.id);
            const { error: insErr } = await supabase.from("notices").insert({
              source_id: sourceId,
              source_category: category,
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
            console.error(`item ${bo}/${it.id}: ${(e as Error).message}`);
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
