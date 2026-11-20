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
// 포스터 재확인: 본문 글자만으로 일시를 못 찾은 행사 글은(일시가 포스터 이미지에만 적힌 경우)
//   events_needing_poster_read RPC 로 골라 포스터를 CLOVA OCR 로 읽고 한 번 더 추출한다.
//   일시를 찾으면 notice_events 를 덮어쓰고, 못 찾아도 poster_read_at 을 찍어 다시 시도하지 않는다.
//   body {"posters": N} → 포스터 재확인만 N건(최대 20). "dryRun": true 를 함께 주면 기록 없이 결과만 돌려준다.
//
// 인증: verify_jwt=false + Authorization: Bearer <CRON_SECRET>.

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ocrConfigured, ocrImages } from "../_shared/clova_ocr.ts";
import { type PushMessage, sendPush } from "../_shared/push.ts";

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
  body_image_urls?: string[] | null;
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

const KIND_LABEL: Record<string, string> = { event: "참석 행사(event)", giveaway: "참여 이벤트(giveaway)" };

function buildUserPrompt(n: NoticeRow, ownerName: string | undefined, posterText = "", priorKind = ""): { prompt: string; truncated: boolean } {
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
  if (posterText) {
    lines.push("", "## 포스터에서 읽은 글자 (본문 이미지 OCR — 줄 순서가 뒤섞여 있을 수 있다)", posterText.slice(0, MAX_BODY_CHARS));
    // 포스터의 제출처·상금 표 같은 곁가지에 끌려 '모집 공고'로 뒤집히는 것을 막는다(공학학술제·연속 특강에서 실제로 뒤집혔다).
    if (KIND_LABEL[priorKind]) {
      lines.push(
        "",
        "## 이번 요청",
        `이 글은 제목과 본문으로 이미 ${KIND_LABEL[priorKind]}로 판정됐다. 이번에는 포스터에서 일시·장소·참석 대상을 찾아 채우는 것이 목적이다.`,
        "kind는 그대로 둔다. 포스터에 제출처·상금·신청 방법이 함께 적혀 있어도 열리는 날짜와 장소가 있으면 행사다.",
        "여러 회차로 나뉜 프로그램이면 첫 회차 시작을 event_start_at, 마지막 회차 종료를 event_end_at에 적는다.",
        "포스터 내용이 그 판정과 명백히 어긋날 때(장학생·직원 선발, 채용, 결과 발표 등)에만 general로 바꾼다.",
      );
    }
  }
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

async function extractOne(n: NoticeRow, ownerName: string | undefined, posterText = "", priorKind = "") {
  const { prompt, truncated } = buildUserPrompt(n, ownerName, posterText, priorKind);
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

// ---- 포스터 재확인 -----------------------------------------------------------------

const POSTER_BATCH = 3;       // cron 1회당. 장당 OCR 이 수 초 걸리고 1 TPS 라 순차 처리한다.
const POSTER_MAX_BATCH = 20;  // 백필 1회당
const POSTER_MAX_IMAGES = 3;  // 공지당 OCR 장수
const POSTER_MIN_CHARS = 30;  // 이보다 적게 읽히면 글자 없는 이미지로 본다

const NOTICE_SELECT = "id,title,body_text,posted_at,channel,body_image_urls,sources(parser_key,name,scope_type,owner_unit),notice_meta(body_markdown)";

async function loadUnitNames(): Promise<Map<string, string>> {
  const [{ data: depts }, { data: colls }] = await Promise.all([
    supabase.from("departments").select("code,name"),
    supabase.from("colleges").select("code,name"),
  ]);
  const m = new Map<string, string>();
  for (const r of [...(colls ?? []), ...(depts ?? [])] as { code: string; name: string }[]) m.set(r.code, r.name);
  return m;
}

async function readPosters(limit: number, dryRun = false) {
  const res = { pending: 0, dated: 0, nodate: 0, failed: 0, results: [] as Record<string, unknown>[] };
  if (!ocrConfigured()) return { ...res, skipped: "ocr not configured" };
  const { data, error } = await supabase.rpc("events_needing_poster_read", { lim: limit });
  if (error) return { ...res, error: error.message };
  const ids = ((data ?? []) as { notice_id: string }[]).map((r) => r.notice_id);
  res.pending = ids.length;
  if (ids.length === 0) return res;

  const [{ data: notices, error: qErr }, { data: prior }, codeToName] = await Promise.all([
    supabase.from("notices").select(NOTICE_SELECT).in("id", ids),
    supabase.from("notice_events").select("notice_id,kind").in("notice_id", ids),
    loadUnitNames(),
  ]);
  if (qErr) return { ...res, error: qErr.message };
  const kindOf = new Map(((prior ?? []) as { notice_id: string; kind: string | null }[]).map((r) => [r.notice_id, r.kind ?? ""]));

  for (const n of (notices ?? []) as unknown as NoticeRow[]) {
    const imgs = (n.body_image_urls ?? []).filter((u) => /^https?:\/\//.test(u));
    try {
      const posterText = await ocrImages(imgs, POSTER_MAX_IMAGES);
      const update: Record<string, unknown> = { poster_read_at: new Date().toISOString() };
      let found = false;
      let fields: EventFields | null = null;
      if (posterText.length >= POSTER_MIN_CHARS) {
        const owner = one(n.sources)?.owner_unit;
        const { truncated: _t, usage: _u, ...f } = await extractOne(n, owner ? codeToName.get(owner) : undefined, posterText, kindOf.get(n.id) ?? "");
        fields = f;
        found = (f.kind === "event" || f.kind === "giveaway") && !!(f.event_start_at || f.event_end_at);
        // 일시를 찾았으면 반영한다. 처음 판정을 유지하라고 했는데도 행사가 아니라고 하면(장학생 선발 등)
        // 본문 없이 제목만 보고 내린 처음 판정이 틀린 것이므로 그것도 반영해 행사 탭에서 뺀다.
        if (found || f.kind === "general") Object.assign(update, f);
      }
      if (!dryRun) {
        const { error: upErr } = await supabase.from("notice_events").update(update).eq("notice_id", n.id);
        if (upErr) throw new Error(`update: ${upErr.message}`);
      }
      if (found) res.dated++; else res.nodate++;
      res.results.push(dryRun
        ? { id: n.id, title: n.title, ocr_chars: posterText.length, found, fields }
        : { id: n.id, ocr_chars: posterText.length, found });
    } catch (e) {
      const msg = errorLabel(e);
      res.failed++;
      res.results.push({ id: n.id, error: msg });
      console.error(`poster read ${n.id} failed: ${msg}`);
      // 일시적인 한도 초과만 다음 실행에서 다시 보고, 그 밖의 실패는 닫는다(5분마다 같은 글에 비용을 쓰지 않게).
      if (!dryRun && !(e instanceof Anthropic.RateLimitError)) {
        await supabase.from("notice_events").update({ poster_read_at: new Date().toISOString() }).eq("notice_id", n.id);
      }
    }
  }
  return res;
}

// ---- 행사 알림 ---------------------------------------------------------------------
// 내 학과·단과대 행사가 새로 올라오면 알림함(notifications)에 기록하고 푸시를 보낸다.
//  - 대상 글: RPC events_needing_alert (아직 안 알린 글, 수집 24시간·게시 3일 이내, 포스터 재확인이 끝난 것)
//  - 받는 사람: profiles.event_alerts_enabled = true (새 앱이 켠다. 구버전 앱은 인스타 공지를 못 열어 제외)
//              이면서 글의 소속 단위(units)가 내 학과·복수전공·단과대와 겹치는 사람
//  - 같은 행사가 게시판·인스타에 따로 올라와도 한 사람에게는 한 번만(similar_ids 로 판단)
//  - 푸시는 notifications_enabled 가 꺼져 있으면 보내지 않고 알림함에만 남긴다(다른 알림과 같은 규칙)

const ALERT_BATCH = 10;
const ALERT_TITLE = "내 학과 새 행사";

type AlertRow = {
  notice_id: string;
  kind: "event" | "giveaway";
  event_name: string | null;
  title: string;
  event_start_at: string | null;
  event_end_at: string | null;
  event_place: string | null;
  source_campus: string | null;
  target_grades: number[] | null;
  target_campuses: string[] | null;
  excludes_undergrad: boolean | null;
  units: string[];
  similar_ids: string[];
};
type AlertProfile = {
  user_id: string;
  grade: number | null;
  campus: string | null;
  dept: string | null;
  dept_secondary: string | null;
  college: string | null;
  notifications_enabled: boolean | null;
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// "11/18(수) 19:00" — 자정은 시간 미상으로 보고 날짜만. 참여 이벤트는 마감을 "…까지"로.
function alertWhen(r: AlertRow): string | null {
  const iso = r.kind === "giveaway" ? (r.event_end_at ?? r.event_start_at) : r.event_start_at;
  if (!iso || isNaN(Date.parse(iso))) return null;
  const k = new Date(Date.parse(iso) + 9 * 3600 * 1000);
  const md = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAYS[d.getUTCDay()]})`;
  const date = md(k);
  // 여러 날 행사는 "12/3(목) ~ 12/4(금)"
  if (r.kind === "event" && r.event_end_at && Date.parse(r.event_end_at) - Date.parse(iso) >= 86_400_000) {
    return `${date} ~ ${md(new Date(Date.parse(r.event_end_at) + 9 * 3600 * 1000))}`;
  }
  const hasTime = !(k.getUTCHours() === 0 && k.getUTCMinutes() === 0);
  const time = hasTime ? ` ${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}` : "";
  return r.kind === "giveaway" ? `${date}${time}까지` : `${date}${time}`;
}

function alertBody(list: AlertRow[]): string {
  const first = list[0];
  const name = first.event_name || first.title;
  if (list.length > 1) return `${name} 외 ${list.length - 1}건`;
  return [name, alertWhen(first), first.event_place].filter(Boolean).join(" · ");
}

// 캠퍼스 일치(다빈치 = 안성). lib/matching.ts 와 같은 규칙.
function campusOk(campus: string | null, targets: string[]): boolean {
  if (!campus) return true;
  return targets.includes(campus) || (campus === "davinci" && targets.includes("anseong"));
}

function alertFits(r: AlertRow, p: AlertProfile): boolean {
  const mine = [p.dept, p.dept_secondary, p.college].filter(Boolean) as string[];
  if (!r.units.some((u) => mine.includes(u))) return false;
  if (r.excludes_undergrad) return false;
  if (r.source_campus && r.source_campus !== "both" && !campusOk(p.campus, [r.source_campus])) return false;
  if (r.target_campuses && r.target_campuses.length > 0 && !campusOk(p.campus, r.target_campuses)) return false;
  if (r.target_grades && r.target_grades.length > 0 && p.grade != null && !r.target_grades.includes(p.grade)) return false;
  return true;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ids 는 드라이런 전용(조건 없이 그 글들로 '누가 받는가'만 계산). 드라이런은 수신 설정과 무관하게 센다.
async function sendEventAlerts(dryRun = false, ids: string[] | null = null) {
  const res = { pending: 0, users: 0, pushes: 0, results: [] as Record<string, unknown>[] };
  const { data, error } = await supabase.rpc("events_needing_alert", ids ? { lim: ids.length, p_ids: ids } : { lim: ALERT_BATCH });
  if (error) return { ...res, error: error.message };
  const rows = (data ?? []) as AlertRow[];
  res.pending = rows.length;
  if (rows.length === 0) return res;

  const profiles: AlertProfile[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from("profiles")
      .select("user_id,grade,campus,dept,dept_secondary,college,notifications_enabled")
      .order("user_id").range(from, from + 999);
    if (!dryRun) q = q.eq("event_alerts_enabled", true);
    const { data: page, error: pErr } = await q;
    if (pErr) return { ...res, error: pErr.message };
    profiles.push(...((page ?? []) as AlertProfile[]));
    if ((page ?? []).length < 1000) break;
  }

  // 같은 행사(또는 이 글 자체)로 이미 알림을 받은 사람은 건너뛴다. 중간에 실패해 다시 돌아도 중복이 없다.
  // 조회가 실패하거나 잘리면(PostgREST 1000행 한도) 이미 받은 사람에게 또 보내게 되므로, 끝까지 페이지를
  // 넘겨 읽고 실패하면 이번 실행은 보내지도 '알림 완료' 표시도 하지 않는다(다음 실행이 다시 한다).
  // overlaps 필터는 URL 에 실리므로 uuid 80개(약 3KB)씩.
  const covered = new Map<string, Set<string>>();
  const known = [...new Set(rows.flatMap((r) => [r.notice_id, ...r.similar_ids]))];
  for (const part of chunk(known, 80)) {
    for (let from = 0; ; from += 1000) {
      const { data: prev, error: prevErr } = await supabase.from("notifications").select("id,user_id,notice_ids")
        .eq("type", "event").overlaps("notice_ids", part).order("id").range(from, from + 999);
      if (prevErr) return { ...res, error: `already-alerted lookup: ${prevErr.message}` };
      for (const n of (prev ?? []) as { user_id: string; notice_ids: string[] }[]) {
        let set = covered.get(n.user_id);
        if (!set) covered.set(n.user_id, set = new Set());
        for (const id of n.notice_ids ?? []) set.add(id);
      }
      if ((prev ?? []).length < 1000) break;
    }
  }

  const perUser = new Map<string, AlertRow[]>();
  for (const r of rows) {
    let recipients = 0;
    for (const p of profiles) {
      if (!alertFits(r, p)) continue;
      let set = covered.get(p.user_id);
      if (!set) covered.set(p.user_id, set = new Set());
      if (set.has(r.notice_id) || r.similar_ids.some((id) => set!.has(id))) continue;
      set.add(r.notice_id);
      const list = perUser.get(p.user_id);
      if (list) list.push(r); else perUser.set(p.user_id, [r]);
      recipients++;
    }
    res.results.push({ id: r.notice_id, body: alertBody([r]), units: r.units, similar: r.similar_ids.length, recipients });
  }
  res.users = perUser.size;
  if (dryRun) return res;

  if (perUser.size > 0) {
    const userIds = [...perUser.keys()];
    const pushOff = new Set(profiles.filter((p) => p.notifications_enabled === false).map((p) => p.user_id));
    const tokens = new Map<string, string[]>();
    for (const part of chunk(userIds.filter((u) => !pushOff.has(u)), 100)) { // in() 은 URL 에 실림 → uuid 100개(약 4KB)
      const { data: toks, error: tokErr } = await supabase.from("push_tokens").select("user_id,token").in("user_id", part).eq("is_active", true);
      // 토큰을 못 읽은 채 진행하면 알림함만 남고 푸시가 빠진 채 '완료'로 표시된다 → 이번 실행은 멈추고 다음에 다시.
      if (tokErr) return { ...res, error: `push_tokens lookup: ${tokErr.message}` };
      for (const t of (toks ?? []) as { user_id: string; token: string }[]) {
        const list = tokens.get(t.user_id);
        if (list) list.push(t.token); else tokens.set(t.user_id, [t.token]);
      }
    }

    const pending = userIds.map((uid) => {
      const list = perUser.get(uid)!;
      return {
        user_id: uid, type: "event", title: ALERT_TITLE, body: alertBody(list),
        notice_ids: list.map((r) => r.notice_id), data: {}, pushed: (tokens.get(uid)?.length ?? 0) > 0,
      };
    });
    const { data: inserted, error: insErr } = await supabase.from("notifications").insert(pending).select("id,user_id");
    // 기록에 실패하면 알렸다고 표시하지 않고 다음 실행에서 다시 한다(보낸 것이 없으니 중복도 없다).
    if (insErr) return { ...res, error: `notifications insert: ${insErr.message}` };
    const idByUser = new Map(((inserted ?? []) as { id: string; user_id: string }[]).map((r) => [r.user_id, r.id]));

    const messages: PushMessage[] = [];
    for (const p of pending) {
      for (const token of tokens.get(p.user_id) ?? []) {
        messages.push({
          to: token, sound: "default", channelId: "event", priority: "high", title: p.title, body: p.body,
          data: { type: "event", noticeIds: p.notice_ids, notificationId: idByUser.get(p.user_id) ?? null },
        });
      }
    }
    // 발송·티켓 확인·앱 지운 기기 토큰 정리는 공통 모듈이 한다(_shared/push.ts).
    const sent = await sendPush(supabase, messages);
    res.pushes = sent.ok;
    if (Object.keys(sent.errors).length > 0) console.error(`event alert push errors: ${JSON.stringify(sent.errors)}`);
  }

  const { error: markErr } = await supabase.from("notice_events")
    .update({ alerted_at: new Date().toISOString() }).in("notice_id", rows.map((r) => r.notice_id));
  if (markErr) console.error(`event alert mark failed: ${markErr.message}`);
  return res;
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("Authorization") !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let body: { dryRun?: boolean; ids?: unknown; batch?: unknown; covers?: unknown; posters?: unknown; alerts?: unknown } = {};
  try { body = await req.json(); } catch { /* cron 빈 body */ }

  // 행사 알림 전용 모드. {"alerts":true,"dryRun":true,"ids":[…]} 는 그 글들이 새로 올라왔다면 누가 받는지 세기만 한다.
  if (body.alerts === true) {
    const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 20) : null;
    if (ids && body.dryRun !== true) {
      return new Response(JSON.stringify({ error: "ids 는 dryRun 에서만 쓸 수 있습니다" }), { status: 400 });
    }
    const alerts = await sendEventAlerts(body.dryRun === true, ids && ids.length ? ids : null);
    return new Response(JSON.stringify({ mode: "alerts", dryRun: body.dryRun === true, alerts }), { headers: { "Content-Type": "application/json" } });
  }

  // 커버 전용 모드(백필): LLM 호출 없음
  if (Number.isInteger(body.covers) && (body.covers as number) > 0) {
    const covers = await makeCovers(Math.min(body.covers as number, COVER_MAX_BATCH));
    return new Response(JSON.stringify({ mode: "covers", covers }), { headers: { "Content-Type": "application/json" } });
  }

  // 포스터 재확인 전용 모드(백필·검증)
  if (Number.isInteger(body.posters) && (body.posters as number) > 0) {
    const posters = await readPosters(Math.min(body.posters as number, POSTER_MAX_BATCH), body.dryRun === true);
    return new Response(JSON.stringify({ mode: "posters", dryRun: body.dryRun === true, posters }), { headers: { "Content-Type": "application/json" } });
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
      // 새로 추출할 글이 없어도 밀린 커버·포스터 재확인은 이어서 한다.
      const covers = await makeCovers(COVER_BATCH);
      const coverPurge = await purgeCovers();
      const { results: _r, ...posters } = await readPosters(POSTER_BATCH);
      const { results: _a, ...alerts } = await sendEventAlerts();
      return new Response(JSON.stringify({ fetched: 0, extracted: 0, failed: 0, covers, coverPurge, posters, alerts }), { headers: { "Content-Type": "application/json" } });
    }
  }

  const [{ data: notices, error: qErr }, codeToName] = await Promise.all([
    supabase.from("notices").select(NOTICE_SELECT).in("id", ids),
    loadUnitNames(),
  ]);
  if (qErr) return new Response(JSON.stringify({ error: qErr.message }), { status: 500 });

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
  // 방금 추출에서 일시를 못 찾은 행사 글의 포스터를 읽어 본다.
  let posters: Record<string, unknown> | undefined;
  if (!dryRun) { const { results: _r, ...p } = await readPosters(POSTER_BATCH); posters = p; }
  // 일시까지 정해진 새 행사를 내 학과 사람들에게 알린다.
  let alerts: Record<string, unknown> | undefined;
  if (!dryRun) { const { results: _a, ...a } = await sendEventAlerts(); alerts = a; }

  return new Response(JSON.stringify({ dryRun, model: MODEL, ...stats, covers, coverPurge, posters, alerts, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
