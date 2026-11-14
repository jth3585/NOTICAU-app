// event_extract — 공지에서 '행사' 정보를 뽑는 2차 패스 (llm_classify 와 분리)
//
// 왜 분리했나: 행사 추출 지시를 llm_classify 본 프롬프트에 붙였더니
//  ① 기존 topic 분류가 흔들리고(선거 글이 교내외활동→재학상태로 쏠림)
//  ② 공개범위(event_open)가 '게시판 소속→target_depts' 지시에 끌려가 일일호프도 members 로 나왔다.
// 그래서 짧은 전용 프롬프트로 따로 호출한다. 기존 분류에는 영향이 없고, 과거 공지 백필도 가능하다.
//
// 입력은 이미 분류가 끝난 공지: 원문 body_text + (본문이 이미지뿐이면) notice_meta.body_markdown.
// body_markdown 에는 llm_classify 가 OCR 로 읽어낸 포스터 내용이 들어 있어 OCR 을 다시 돌리지 않는다.
//
// 운영(5분 cron, body {}): notices_needing_events RPC 로 '분류는 끝났고 행사 추출은 아직'인 공지를
//   batch 건(기본 30, 최대 200) 받아 notice_events 에 upsert. 실패는 kind=null + attempts 로 남겨 3회까지 재시도.
// 검증(dryRun): 응답으로만 돌려주고 DB 기록 없음.
//   body: { "dryRun": true, "ids": ["<notice uuid>", ...최대 40] }
//
// 커버(행사 탭의 포스터 썸네일): 추출이 끝난 뒤 같은 실행에서 events_needing_covers RPC 가 고른 행사 글의
//   첫 이미지를 가로 720px WebP 로 줄여 Storage 'crawled-images/ev/<notice_id>.webp' 에 올리고
//   notice_events.cover_url·cover_ratio 를 채운다. 원본은 장당 수 MB 라 앱 목록에서 그대로 쓸 수 없다.
//   줄이는 일은 공개 리사이즈 프록시(wsrv.nl)에 맡긴다 — 엣지 함수 CPU 한도로는 큰 포스터 디코딩이 어렵다.
//   앱은 우리 Storage 만 보므로 프록시가 죽어도 이미 만든 커버는 그대로 나온다(새 커버만 밀린다).
//   body {"covers": N} → 추출 없이 커버만 N건(최대 60) 만든다(백필용).
//
// 인증: verify_jwt=false + Authorization: Bearer <CRON_SECRET>.

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = "claude-haiku-5-5";
// Haiku 5.5 는 적응형 사고가 기본으로 켜져 있고 사고 토큰도 max_tokens 에 포함된다 → 짧은 JSON 이어도 넉넉히.
const MAX_TOKENS = 4000;
const MAX_IDS = 40;
const DEFAULT_BATCH = 30;
const MAX_BATCH = 200; // 백필용. 건당 ~2초 × 동시 5 → 200건 ≈ 80초(wall clock 150초 이내)
const CONCURRENCY = 5;
const MAX_BODY_CHARS = 20000; // 오염된 초장문 방어. 넘으면 잘랐다는 사실을 프롬프트·응답에 남긴다.

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

const SYSTEM_PROMPT = `당신은 중앙대학교 공지·학생회 게시물에서 '행사' 정보를 뽑아내는 도우미입니다. 공지 1건을 읽고 아래 필드를 JSON으로 답합니다. 원문에 없는 내용은 지어내지 않습니다.

## kind — 이 글의 종류 (넷 중 하나)
- "event": 정해진 일시에 정해진 장소(또는 온라인)에서 열리고, 학생이 그 자리에 '참석'하는 것이 글의 핵심.
  예: 특강·세미나·콜로퀴엄·설명회·포럼·심포지엄·토크콘서트·박람회·공연·연주회·전시·상영회·축제·학술제·일일호프·개강/종강총회·MT·체육대회·현장에서 치르는 대회·해커톤.
  사전 신청이 필요해도 참석형이면 event.
- "giveaway": 참석이 아니라 혜택을 받는 것이 핵심. 간식·굿즈 배부, 경품 추첨, 댓글·인증·설문 참여 이벤트, 제휴 할인.
- "election": 학생회·학생자치기구 선거에 관한 글 전부 — 선거 일정, 후보 등록, 선전물, 공약, 출마 소견, 공직 사퇴, 선관위 구성, 투표 안내, 개표 결과, 선거 공청회·토론회.
- "general": 그 외 전부. 아래는 event가 아니라 general이다.
  · 작품·서류를 내는 공모전, 서포터즈·기자단·단원 모집, 여러 주에 걸친 교육과정·프로그램 수강생 모집, 교환학생·인턴·채용.
  · 행사를 **돕는 사람**을 뽑는 글(축제·캠프·발표회의 자원봉사자·멘토·스태프 모집). 그 행사의 일시·장소가 적혀 있어도 모집 공지다.
  · 시험·평가·점검(졸업시험, 자격시험, 생활관 생활점검, 시설 점검)과 수업·보강 — 의무 일정이지 행사가 아니다.
  · 신청형 서비스(귀향버스 같은 교통편, 사물함·물품 대여)와 그 환불·변경 안내.
  · 정해진 일시 없이 상시 운영되는 프로그램·상담 안내.
  · 결과·수상자·당첨자 발표(경품 이벤트의 당첨자 공지도 giveaway가 아니라 general), 회계 보고, 일정표(학사달력), 시설·운영 안내, 수요조사.
  판단 기준: "가고 싶어서 달력에 '이 날 여기 간다'고 적을 일인가?" 그렇다 → event.

## 행사 정보 — kind가 "general"이면 전부 null
event뿐 아니라 giveaway(배부·진행 기간)와 election(투표 기간, 공청회 일시·장소)도 원문에 일시·장소가 적혀 있으면 채운다.
- event_name: 행사의 고유 이름만 짧게(30자 이내). "안내·개최·공지·홍보·모집·포스터·NEW", 대괄호 말머리, 날짜, 맨 앞의 연도·학년도 표기는 뺀다(회차 "제47회"는 유지). 원문의 공식 명칭을 그대로 쓴다.
- event_start_at / event_end_at: 행사가 실제로 열리는 시작·종료 일시(신청 기간이 아니다). ISO 8601, 한국시간(+09:00). 연도가 생략됐으면 게시일을 기준으로 추정한다. 시간이 적혀 있지 않으면 00:00:00으로 둔다. 하루짜리이고 종료 시각이 없으면 event_end_at은 null. 여러 날이면 마지막 날을 event_end_at에. 일시를 알 수 없으면 둘 다 null.
- event_place: 장소를 원문 그대로 짧게("310관 B501호", "온라인(Zoom)"). 없으면 null.

## 참석 대상 — kind가 "general"이면 둘 다 null
- audience_quote: 원문에서 '누가 참석(참여)할 수 있는지'를 밝힌 구절을 그대로 옮긴다(예: "서울, 다빈치 캠퍼스 재학생 대상", "경영학부 재학생"). 그런 구절이 없으면 null. 주최자·게시자 이름은 참석 대상이 아니다.
- event_open: 이 대학의 **다른 학과 학생이 가도 되는가**.
  · "all" — 가도 된다. 다음은 모두 "all"이다.
    - audience_quote가 없고, 아래 '내부 행사'에도 해당하지 않는 경우 (기본값)
    - 대상이 전교생·재학생 전체·양 캠퍼스·누구나·일반인으로 적힌 경우
    - 일일호프, 공연·연주회·전시·상영회, 축제, 학술제, 공개 특강·세미나·심포지엄, 대회, 외부 기관이 여는 행사
    - "○○학과 재학생은 할인/우대"처럼 특정 학과에 혜택만 주는 경우(타과생도 올 수 있다는 뜻)
    - 학과 게시판·학생회 계정이 학교 본부나 외부 기관의 행사를 옮겨 적은 글
  · "members" — 주최 학과·단과대 구성원만. 다음 둘 중 하나일 때만 쓴다.
    - audience_quote가 참석 대상을 특정 학과·단과대·전공 소속 학생으로 한정한 경우
    - 성격상 구성원끼리 하는 내부 행사: 개강/종강총회, MT, 학과 체육대회, 학과 간담회, 학과 간식행사, 선거·투표·선거 공청회
  · 주의: 입력의 '게시 주체'는 글을 올린 곳일 뿐이다. 학과 게시판에 올라왔다는 이유만으로 "members"로 하지 말 것. 학년·유학생·기숙사생 같은 소속 학과 외의 조건은 event_open과 무관하다(그런 조건만 있으면 "all").`;

const NULLABLE_STRING = { anyOf: [{ type: "string" }, { type: "null" }] };
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["event", "giveaway", "election", "general"] },
    event_name: NULLABLE_STRING,
    event_start_at: NULLABLE_STRING,
    event_end_at: NULLABLE_STRING,
    event_place: NULLABLE_STRING,
    audience_quote: NULLABLE_STRING,
    event_open: { anyOf: [{ type: "string", enum: ["all", "members"] }, { type: "null" }] },
  },
  required: ["kind", "event_name", "event_start_at", "event_end_at", "event_place", "audience_quote", "event_open"],
  additionalProperties: false,
};

type EventFields = {
  kind: "event" | "giveaway" | "election" | "general";
  event_name: string | null;
  event_start_at: string | null;
  event_end_at: string | null;
  event_place: string | null;
  audience_quote: string | null;
  event_open: "all" | "members" | null;
};

type SourceRow = { parser_key: string | null; name: string | null; scope_type: string | null; owner_unit: string | null };
type NoticeRow = {
  id: string;
  title: string;
  body_text: string | null;
  posted_at: string | null;
  channel: string | null;
  sources: SourceRow | SourceRow[] | null;
  notice_meta: { body_markdown: string | null } | { body_markdown: string | null }[] | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

// 게시 주체를 사람이 읽는 한 줄로. 참석 대상 힌트가 아니라 '누가 올렸나'만 알려준다.
function describeSource(src: SourceRow | null, channel: string | null, ownerName: string | undefined): string {
  const name = src?.name ?? src?.parser_key ?? "(미상)";
  if (channel === "instagram") return `${name} (학생회 인스타그램 계정)`;
  const kind = src?.scope_type === "dept" ? "학과 게시판"
    : src?.scope_type === "college" ? "단과대 게시판"
    : "본교·행정부서 게시판";
  return ownerName && ownerName !== name ? `${name} (${kind}, 소속: ${ownerName})` : `${name} (${kind})`;
}

function kstDate(iso: string | null): string {
  if (!iso || isNaN(Date.parse(iso))) return "(미상)";
  return new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function buildUserPrompt(n: NoticeRow, ownerName: string | undefined): { prompt: string; truncated: boolean } {
  const body = (n.body_text ?? "").trim();
  const md = (one(n.notice_meta)?.body_markdown ?? "").trim();
  // 본문이 짧으면(이미지 공지) OCR 내용이 담긴 정리본을 함께 준다. 본문이 충분하면 원문만(정리본은 중복).
  const useMd = body.length < 200 && md.length > 0;
  let text = body || "(본문 없음)";
  let truncated = false;
  if (text.length > MAX_BODY_CHARS) { text = text.slice(0, MAX_BODY_CHARS); truncated = true; }

  const lines = [
    `제목: ${n.title}`,
    `게시일: ${kstDate(n.posted_at)}`,
    `게시 주체: ${describeSource(one(n.sources), n.channel, ownerName)}`,
    "",
    "## 본문",
    text,
  ];
  if (truncated) lines.push("", `(본문이 길어 앞 ${MAX_BODY_CHARS}자만 실었다.)`);
  if (useMd) lines.push("", "## 정리본 (본문 이미지에서 읽어낸 내용 포함)", md.slice(0, MAX_BODY_CHARS));
  return { prompt: lines.join("\n"), truncated };
}

function normalize(f: EventFields): EventFields {
  for (const k of ["event_name", "event_place", "audience_quote"] as const) {
    if (typeof f[k] === "string" && f[k]!.trim() === "") f[k] = null;
  }
  for (const k of ["event_start_at", "event_end_at"] as const) {
    if (f[k] && isNaN(Date.parse(f[k]!))) f[k] = null;
  }
  if (f.kind === "general") {
    f.event_name = f.event_start_at = f.event_end_at = f.event_place = f.audience_quote = f.event_open = null;
  }
  return f;
}

async function extractOne(n: NoticeRow, ownerName: string | undefined) {
  const { prompt, truncated } = buildUserPrompt(n, ownerName);
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") throw new Error("refusal");
  if (response.stop_reason === "max_tokens") throw new Error(`output truncated at max_tokens=${MAX_TOKENS}`);
  // 사고 블록이 앞에 올 수 있으므로 위치가 아니라 type 으로 텍스트를 찾는다.
  const text = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  const fields = normalize(JSON.parse(text) as EventFields);
  return {
    ...fields,
    truncated,
    usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
  };
}

function errorLabel(e: unknown): string {
  if (e instanceof Anthropic.RateLimitError) return "rate_limited";
  if (e instanceof Anthropic.BadRequestError) return `bad_request: ${e.message.slice(0, 160)}`;
  if (e instanceof Anthropic.APIError) return `api_error ${e.status}: ${e.message.slice(0, 160)}`;
  return String((e as Error)?.message ?? e).slice(0, 200);
}

// ---- 행사 커버 ---------------------------------------------------------------------

const COVER_BUCKET = "crawled-images"; // cau_dorm·cau_instagram 과 같은 공개 버킷
const COVER_WIDTH = 720;       // 2열 카드(@3x ≈ 520px)와 캐러셀 카드(@3x ≈ 780px)를 함께 덮는 폭
const COVER_BATCH = 8;         // cron 1회당
const COVER_MAX_BATCH = 60;    // 백필 1회당
const COVER_CONCURRENCY = 4;
const COVER_TRY_IMAGES = 3;    // 첫 이미지가 로고·띠배너면 다음 이미지로
const COVER_TIMEOUT_MS = 20_000;
const COVER_MAX_BYTES = 600_000;
const COVER_MAX_ATTEMPTS = 3;  // events_needing_covers 의 cover_attempts < 3 과 맞춘다

// WebP 헤더에서 크기를 읽는다(VP8 손실 / VP8L 무손실 / VP8X 확장).
function webpSize(b: Uint8Array): { w: number; h: number } | null {
  if (b.length < 30) return null;
  const tag = (i: number) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WEBP") return null;
  const fmt = tag(12);
  if (fmt === "VP8 ") return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
  if (fmt === "VP8L") {
    const n = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1 };
  }
  if (fmt === "VP8X") return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  return null;
}

// 이미지 1장을 줄여서 받아 온다. 포스터로 쓸 수 없으면(작은 로고, 띠배너) 'unfit', 받지 못하면 'error'.
async function fetchCover(src: string): Promise<{ bytes: Uint8Array; ratio: number } | "unfit" | "error"> {
  try {
    // we = 원본보다 키우지 않음 → 돌아온 폭이 작으면 원본이 작은 것(아이콘·로고)
    const url = `https://wsrv.nl/?url=${encodeURIComponent(src)}&w=${COVER_WIDTH}&we&output=webp&q=78`;
    const res = await fetch(url, { signal: AbortSignal.timeout(COVER_TIMEOUT_MS) });
    if (!res.ok) { await res.body?.cancel(); return "error"; }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const size = webpSize(bytes);
    if (!size || size.w === 0 || size.h === 0 || bytes.length > COVER_MAX_BYTES) return "error";
    const ratio = size.w / size.h;
    if (size.w < 240 || ratio > 2.2 || ratio < 0.3) return "unfit";
    return { bytes, ratio: Math.round(ratio * 1000) / 1000 };
  } catch {
    return "error";
  }
}

async function makeCovers(limit: number) {
  const res = { pending: 0, made: 0, unfit: 0, failed: 0 };
  const { data, error } = await supabase.rpc("events_needing_covers", { lim: limit });
  if (error) return { ...res, error: error.message };
  const rows = (data ?? []) as { notice_id: string; body_image_urls: string[] | null; cover_attempts: number }[];
  res.pending = rows.length;
  let next = 0;
  async function worker() {
    while (next < rows.length) {
      const r = rows[next++];
      let cover: { bytes: Uint8Array; ratio: number } | null = null;
      let sawError = false;
      for (const src of (r.body_image_urls ?? []).slice(0, COVER_TRY_IMAGES)) {
        const c = await fetchCover(src);
        if (c === "error") { sawError = true; continue; }
        if (c === "unfit") continue;
        cover = c;
        break;
      }
      if (cover) {
        const path = `ev/${r.notice_id}.webp`;
        const { error: upErr } = await supabase.storage.from(COVER_BUCKET)
          .upload(path, cover.bytes, { contentType: "image/webp", upsert: true, cacheControl: "31536000" });
        if (!upErr) {
          const publicUrl = supabase.storage.from(COVER_BUCKET).getPublicUrl(path).data.publicUrl;
          const { error: dbErr } = await supabase.from("notice_events")
            .update({ cover_url: publicUrl, cover_ratio: cover.ratio }).eq("notice_id", r.notice_id);
          if (!dbErr) { res.made++; continue; }
          console.error(`cover db ${r.notice_id}: ${dbErr.message}`);
        } else {
          console.error(`cover upload ${path}: ${upErr.message}`);
        }
        sawError = true;
      }
      // 받지 못한 이미지가 있으면 다음 실행에서 다시(3회까지). 전부 포스터감이 아니면 바로 닫는다.
      const attempts = sawError ? r.cover_attempts + 1 : COVER_MAX_ATTEMPTS;
      await supabase.from("notice_events").update({ cover_attempts: attempts }).eq("notice_id", r.notice_id);
      if (sawError) res.failed++; else res.unfit++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(COVER_CONCURRENCY, rows.length) }, worker));
  return res;
}

// 행사 탭에서 빠진 지 오래된(게시 75일 경과) 글의 커버를 Storage 에서 지운다.
async function purgeCovers() {
  const { data, error } = await supabase.rpc("event_covers_expired", { lim: 20 });
  if (error) return { error: error.message };
  const rows = (data ?? []) as { notice_id: string; cover_url: string }[];
  if (rows.length === 0) return { removed: 0 };
  const mark = `/object/public/${COVER_BUCKET}/`;
  const paths = rows.filter((r) => r.cover_url.includes(mark))
    .map((r) => decodeURIComponent(r.cover_url.split(mark)[1].split("?")[0]));
  if (paths.length > 0) {
    const { error: rmErr } = await supabase.storage.from(COVER_BUCKET).remove(paths);
    if (rmErr) return { error: rmErr.message };
  }
  const { error: upErr } = await supabase.from("notice_events")
    .update({ cover_url: null, cover_ratio: null, cover_attempts: COVER_MAX_ATTEMPTS })
    .in("notice_id", rows.map((r) => r.notice_id));
  if (upErr) return { error: upErr.message };
  return { removed: paths.length };
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("Authorization") !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let body: { dryRun?: boolean; ids?: unknown; batch?: unknown; covers?: unknown } = {};
  try { body = await req.json(); } catch { /* cron 빈 body */ }

  // 커버 전용 모드(백필): LLM 호출 없음
  if (Number.isInteger(body.covers) && (body.covers as number) > 0) {
    const covers = await makeCovers(Math.min(body.covers as number, COVER_MAX_BATCH));
    return new Response(JSON.stringify({ mode: "covers", covers }), { headers: { "Content-Type": "application/json" } });
  }

  const dryRun = body.dryRun === true;
  if (dryRun && !Array.isArray(body.ids)) {
    return new Response(JSON.stringify({ error: "dryRun 에는 ids 배열이 필요합니다" }), { status: 400 });
  }

  // 처리 대상: dryRun 은 지정한 ids, 운영은 RPC 가 골라준 미처리 공지.
  const prevAttempts = new Map<string, number>();
  let ids: string[];
  if (dryRun) {
    ids = (body.ids as unknown[]).filter((x): x is string => typeof x === "string").slice(0, MAX_IDS);
  } else {
    const batch = Number.isInteger(body.batch) && (body.batch as number) > 0
      ? Math.min(body.batch as number, MAX_BATCH) : DEFAULT_BATCH;
    const { data: todo, error: tErr } = await supabase.rpc("notices_needing_events", { lim: batch });
    if (tErr) return new Response(JSON.stringify({ error: tErr.message }), { status: 500 });
    for (const r of (todo ?? []) as { id: string; attempts: number }[]) prevAttempts.set(r.id, r.attempts ?? 0);
    ids = [...prevAttempts.keys()];
    if (ids.length === 0) {
      // 새로 추출할 글이 없어도 밀린 커버는 이어서 만든다.
      const covers = await makeCovers(COVER_BATCH);
      const coverPurge = await purgeCovers();
      return new Response(JSON.stringify({ fetched: 0, extracted: 0, failed: 0, covers, coverPurge }), { headers: { "Content-Type": "application/json" } });
    }
  }

  const [{ data: notices, error: qErr }, { data: depts }, { data: colls }] = await Promise.all([
    supabase.from("notices")
      .select("id,title,body_text,posted_at,channel,sources(parser_key,name,scope_type,owner_unit),notice_meta(body_markdown)")
      .in("id", ids),
    supabase.from("departments").select("code,name"),
    supabase.from("colleges").select("code,name"),
  ]);
  if (qErr) return new Response(JSON.stringify({ error: qErr.message }), { status: 500 });

  const codeToName = new Map<string, string>();
  for (const r of [...(colls ?? []), ...(depts ?? [])] as { code: string; name: string }[]) codeToName.set(r.code, r.name);

  const rows = (notices ?? []) as unknown as NoticeRow[];
  const results: Record<string, unknown>[] = new Array(rows.length);
  const stats = { fetched: rows.length, extracted: 0, failed: 0 };
  let next = 0;
  async function worker() {
    while (next < rows.length) {
      const i = next++;
      const n = rows[i];
      const t0 = Date.now();
      const owner = one(n.sources)?.owner_unit;
      const attempts = (prevAttempts.get(n.id) ?? 0) + 1;
      try {
        const r = await extractOne(n, owner ? codeToName.get(owner) : undefined);
        if (!dryRun) {
          const { truncated: _t, usage: _u, ...fields } = r;
          const { error: upErr } = await supabase.from("notice_events").upsert({
            notice_id: n.id, ...fields, llm_model: MODEL, attempts, last_error: null,
            processed_at: new Date().toISOString(),
          });
          if (upErr) throw new Error(`upsert: ${upErr.message}`);
        }
        stats.extracted++;
        results[i] = dryRun ? { id: n.id, ...r, ms: Date.now() - t0 } : { id: n.id, kind: r.kind };
      } catch (e) {
        const msg = errorLabel(e);
        stats.failed++;
        results[i] = { id: n.id, error: msg, ms: Date.now() - t0 };
        if (!dryRun) {
          // kind=null 로 남겨 다음 실행에서 재시도(3회까지). 재시도 한도는 RPC 의 attempts<3 가드.
          await supabase.from("notice_events").upsert({
            notice_id: n.id, kind: null, llm_model: MODEL, attempts, last_error: msg,
            processed_at: new Date().toISOString(),
          });
          console.error(`event_extract ${n.id} failed: ${msg}`);
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));

  // 방금 추출된 행사까지 포함해 커버를 만든다(드라이런은 기록을 남기지 않으므로 건너뛴다).
  const covers = dryRun ? undefined : await makeCovers(COVER_BATCH);
  const coverPurge = dryRun ? undefined : await purgeCovers();

  return new Response(JSON.stringify({ dryRun, model: MODEL, ...stats, covers, coverPurge, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
