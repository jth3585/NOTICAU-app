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
// 현재는 검증 단계 — dryRun 만 지원(응답으로만 돌려주고 DB 기록 없음).
//   body: { "dryRun": true, "ids": ["<notice uuid>", ...최대 40] }
//
// 인증: verify_jwt=false + Authorization: Bearer <CRON_SECRET>.

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = "claude-haiku-5-5";
// Haiku 5.5 는 적응형 사고가 기본으로 켜져 있고 사고 토큰도 max_tokens 에 포함된다 → 짧은 JSON 이어도 넉넉히.
const MAX_TOKENS = 4000;
const MAX_IDS = 40;
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
  · 결과·수상자·당첨자 발표, 회계 보고, 일정표(학사달력), 시설·운영 안내, 수요조사.
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

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("Authorization") !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let body: { dryRun?: boolean; ids?: unknown } = {};
  try { body = await req.json(); } catch { /* 빈 body */ }
  if (body.dryRun !== true || !Array.isArray(body.ids)) {
    return new Response(JSON.stringify({ error: "dryRun:true 와 ids 배열이 필요합니다(운영 모드 미구현)" }), { status: 400 });
  }
  const ids = body.ids.filter((x): x is string => typeof x === "string").slice(0, MAX_IDS);

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
  let next = 0;
  async function worker() {
    while (next < rows.length) {
      const i = next++;
      const n = rows[i];
      const t0 = Date.now();
      const owner = one(n.sources)?.owner_unit;
      try {
        const r = await extractOne(n, owner ? codeToName.get(owner) : undefined);
        results[i] = { id: n.id, ...r, ms: Date.now() - t0 };
      } catch (e) {
        results[i] = { id: n.id, error: errorLabel(e), ms: Date.now() - t0 };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));

  return new Response(JSON.stringify({ dryRun: true, model: MODEL, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
