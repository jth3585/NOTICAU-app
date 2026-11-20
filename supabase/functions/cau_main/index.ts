// cau_main — 중앙대 본교 공지 크롤러 (GitHub Actions → Edge Function 이관, v1.30)
//
// 학교 AJAX API 2개 사용:
//   목록: https://www.cau.ac.kr/ajax/FR_SVC/BBSViewList2.do
//   본문: https://www.cau.ac.kr/ajax/FR_SVC/BoardViewData.do
//
// 설계: 크롤러는 notices INSERT만. LLM 분류는 별도 llm_classify 함수가 5분마다 미분류분 처리.
//       (Edge Function wall-clock 한도 회피 — 크롤+LLM 동시 루프 금지)
//
// 인증: verify_jwt=false + Authorization: Bearer <CRON_SECRET> 자체 검증 (push 함수와 동일).
// dedup: content_hash = sha256(title|source_url|posted_at) — Node 크롤러와 동일 알고리즘/포맷 유지.
//
// 호출: pg_cron이 매시 정각. body {"pages": N}로 다중 페이지(백필) 선택 가능(기본 1).

import { load } from "npm:cheerio";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SOURCE_PARSER_KEY = "cau_main";
const BASE = "https://www.cau.ac.kr";
const TAB_NO_ALL = 1;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; NOTICAU/0.1; +https://github.com/your/noticau)",
  "Accept": "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "Origin": BASE,
  "Referer": `${BASE}/cms/FR_CON/index.do?MENU_ID=100`,
  "X-Requested-With": "XMLHttpRequest",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// content_hash = sha256(title|source_url|posted_at) (Node crypto와 동일 결과)
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// "2026-05-22 09:01:36.0" 또는 "2026.05.22" → "YYYY-MM-DDTHH:MM:SS+09:00"
function parseDateTime(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/(\d{4})[-.](\d{2})[-.](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00", se = "00"] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${se}+09:00`;
}

function buildSourceUrl(bbsSeq: string | number): string {
  return `${BASE}/cms/FR_CON/BoardView.do?MENU_ID=100&SITE_NO=2&BOARD_SEQ=4&BBS_SEQ=${bbsSeq}&CONTENTS_NO=1&pageNo=1`;
}

// deno-lint-ignore no-explicit-any
function normalizeListItem(item: any) {
  return {
    bbs_seq: item.BBS_SEQ,
    title: item.SUBJECT,
    author: item.WRITER_NM,
    source_category: item.CATEGORY_NM1,
    campus_hint: item.CATEGORY_NM2,
    posted_at: parseDateTime(item.WRITE_DT),
    is_pinned: false,
    file_count: item.FILE_CNT || 0,
    source_url: buildSourceUrl(item.BBS_SEQ),
  };
}

async function fetchList(pageNo = 1, pagePerCnt = 15) {
  const body = new URLSearchParams({
    pageNo: String(pageNo),
    pagePerCnt: String(pagePerCnt),
    MENU_ID: "100",
    SITE_NO: "2",
    BOARD_SEQ: "4",
    S_CATE_SEQ: "",
    BOARD_TYPE: "C0301",
    BOARD_CATEGORY_NO: "",
    P_TAB_NO: String(TAB_NO_ALL),
    TAB_NO: "",
    CATE_SEQ: "",
    SEARCH_FLD: "SUBJECT",
    SEARCH: "",
  });
  const res = await fetch(`${BASE}/ajax/FR_SVC/BBSViewList2.do`, {
    method: "POST",
    headers: HEADERS,
    body,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`list fetch failed: ${res.status}`);
  const json = await res.json();
  const list = json?.data?.list || [];
  return list.map(normalizeListItem);
}

async function fetchDetail(bbsSeq: string | number) {
  const body = new URLSearchParams({
    MENU_ID: "100",
    SITE_NO: "2",
    BOARD_SEQ: "4",
    BBS_SEQ: String(bbsSeq),
    CONTENTS_NO: "1",
    pageNo: "1",
  });
  const res = await fetch(`${BASE}/ajax/FR_SVC/BoardViewData.do`, {
    method: "POST",
    headers: HEADERS,
    body,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`detail fetch failed: ${res.status} for BBS_SEQ=${bbsSeq}`);
  const json = await res.json();
  const d = json?.data;
  if (!d) throw new Error(`empty detail for BBS_SEQ=${bbsSeq}`);

  const html = d.CONTENTS || "";
  const $ = load(html);
  const bodyText = $.text().replace(/\s+/g, " ").replace(/&nbsp;/g, " ").trim();

  const imageUrls: string[] = [];
  $("img").each((_, el) => {
    let src = $(el).attr("src");
    if (!src) return;
    if (src.startsWith("//")) src = "https:" + src;
    else if (src.startsWith("/")) src = BASE + src;
    else if (src.startsWith("http://")) src = "https://" + src.slice(7);
    else if (!src.startsWith("https://")) return;
    if (!imageUrls.includes(src)) imageUrls.push(src);
  });

  const attachments: { type: string; filename: string; url: string }[] = [];
  if (d.PDF_FILE) {
    attachments.push({
      type: "pdf",
      filename: String(d.PDF_FILE).split("/").pop()!,
      url: `${BASE}/cms/data/board/${d.PDF_FILE}`,
    });
  }

  return {
    title: d.SUBJECT,
    body_text: bodyText,
    body_image_urls: imageUrls,
    attachments,
    author: d.WRITER_NM,
    posted_at: parseDateTime(d.REG_DATE || d.WRITE_DATE),
    source_url: buildSourceUrl(d.BBS_SEQ),
  };
}

Deno.serve(async (req) => {
  // ---- 인증 ----
  const cronSecret = Deno.env.get("CRON_SECRET");
  const auth = req.headers.get("Authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let pages = 1;
  try {
    const body = await req.json();
    if (body && Number.isInteger(body.pages) && body.pages > 0) pages = Math.min(body.pages, 30);
  } catch { /* 빈 body(cron) → 기본 1페이지 */ }

  // source_id 조회
  const { data: source, error: sErr } = await supabase
    .from("sources").select("id").eq("parser_key", SOURCE_PARSER_KEY).single();
  if (sErr || !source) {
    return new Response(JSON.stringify({ error: `source not found: ${SOURCE_PARSER_KEY}` }), { status: 500 });
  }
  const sourceId = source.id;

  const stats = { pages: 0, listed: 0, skippedDup: 0, insertedNotices: 0, fetchFailed: 0 };

  try {
    for (let page = 1; page <= pages; page++) {
      const items = await fetchList(page, 15);
      stats.listed += items.length;
      stats.pages++;
      if (items.length === 0) break;

      for (const item of items) {
        try {
          const contentHash = await sha256Hex(`${item.title}|${item.source_url}|${item.posted_at}`);
          const { data: existing } = await supabase
            .from("notices").select("id").eq("content_hash", contentHash).maybeSingle();
          if (existing) { stats.skippedDup++; continue; }

          const detail = await fetchDetail(item.bbs_seq);
          const { error: insErr } = await supabase.from("notices").insert({
            source_id: sourceId,
            source_category: item.source_category,
            title: detail.title,
            body_text: detail.body_text,
            body_image_urls: detail.body_image_urls,
            attachment_urls: detail.attachments.map((a) => a.url),
            source_url: detail.source_url,
            author: detail.author,
            posted_at: detail.posted_at,
            is_pinned: item.is_pinned,
            content_hash: contentHash,
          });
          if (insErr) {
            if (insErr.code === "23505") { stats.skippedDup++; continue; }
            throw insErr;
          }
          stats.insertedNotices++;
        } catch (e) {
          console.error(`item ${item.bbs_seq}: ${(e as Error).message}`);
          stats.fetchFailed++;
        }
        await sleep(2000); // 학교 서버 예의
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
