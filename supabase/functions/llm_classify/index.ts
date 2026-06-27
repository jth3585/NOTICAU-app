// llm_classify — 미분류 notices를 Claude Haiku로 분류·요약 (v1.30, 5분 cron)
//
// 크롤러(cau_*)는 notices INSERT만 하고, 이 함수가 notice_meta 없는 건을 batch로 분류.
// Edge Function wall-clock 한도 회피 위해 한 번에 BATCH건만 처리(기본 8).
//
// 인증: verify_jwt=false + Authorization: Bearer <CRON_SECRET>.
// sharp 제거: 이미지-only 공지는 ≤4.5MB·허용 타입이면 원본 base64 전송, 초과/실패 시 스킵(텍스트 fallback).
//
// v1.31 비용 보호:
//  - 각 공지 처리 시작 시 classify_attempts += 1 → RPC의 <3 가드로 3회 실패 후 영구 제외(무한 재시도 차단).
//  - 실패 시 classify_last_error 기록(원인 가시화), 성공 시 null로 클리어.
//  - SYSTEM_PROMPT prompt caching(ephemeral)으로 배치 내 입력 토큰 절감.
//  - MAX_TOKENS 16000 + stop_reason=max_tokens(출력 잘림) 감지 → 긴 본문 분류, 잘림은 재시도 안 함(낭비 차단).

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding/base64";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 16000; // 8000→16000: 긴 본문 body_markdown 잘림 방지 (출력 토큰은 실제 생성분만 과금)
const MAX_ATTEMPTS = 2;
const DEFAULT_BATCH = 8;

// 출력이 max_tokens로 잘린 경우 — 같은 설정으로 재시도해도 또 잘리므로 재시도하지 않는다.
class TruncationError extends Error {}

const TOPICS = [
  "학사정보", "장학&등록금", "채용&인턴", "교내외활동",
  "창업", "기숙사", "재학상태", "시설&시스템",
];

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

function topicHintForLLM(sourceCategory: string | null): string {
  const hints: Record<string, string> = {
    "모집": "교내외활동 가능성 높음. 단, 채용 모집이면 '채용&인턴', 창업 관련이면 '창업'. 신입생 전용이면 '재학상태'+targets_freshmen=true, 학적 변동이면 '재학상태'",
    "일반": "공지 내용에 따라 자유롭게 분류. 시스템·시설 안내면 '시설&시스템', 그 외에는 본문 보고 판단",
    "학사": "학사정보로 매핑 권장",
    "학점교류": "학사정보로 매핑 권장",
    "장학": "장학&등록금으로 매핑 권장",
    "행사": "교내외활동으로 매핑 권장. 단 창업 관련이면 '창업'",
    "추천채용": "채용&인턴으로 매핑 권장",
  };
  return (sourceCategory && hints[sourceCategory]) || "본문 보고 자유롭게 분류";
}

const SYSTEM_PROMPT = `당신은 중앙대학교(CAU) 학부생을 위한 공지 분류 + 본문 정리 도우미입니다.

## 분류 원칙
카테고리는 "공지가 무엇을 다루는가"가 아니라 "학부생 입장에서 이 공지가 어떤 결정·행동의 맥락에 들어가는가"로 판단. 같은 "모집" 공지여도 단기 활동이면 교내외활동, 진로 결정이면 재학상태.

## 임무
공지 1건을 받아서 다음 정보를 JSON으로 추출합니다:
- 8개 카테고리(topic) 중 하나
- 액션 타입 (actionable / info)
- 한 줄 요약 (40자 이내) + 상세 요약 (150자 이내)
- 마감일 (있으면)
- 대상 학년/학과/캠퍼스 (명시되어 있으면)
- 대학원생·교직원·외부인 대상이면 excludes_undergrad=true
- 본문 마크다운 재구성 (body_markdown)

## 8개 카테고리 정의
- 학사정보: 수강신청, 성적, 졸업요건, 시험, 학적, 계절학기, 교직과정
- 장학&등록금: 장학금(교내·국가·외부), 근로장학(교내 근로장학생 모집·교내 근로), 학자금대출, 등록금
- 채용&인턴: 채용공고, 인턴십, 채용박람회, 취업특강, 멘토링, 직무특강, 실무역량 교육
- 교내외활동: 일회성·단기 활동 (공모전, 봉사, 해외교류, 교환학생, 워크숍, 행사, 비교과 프로그램). 학적 변화나 진로 결정과 직결되는 공지는 "재학상태"로
- 창업: 창업지원, 창업경진대회, 창업동아리, 액셀러레이팅
- 기숙사: 생활관 관련 (입주, 퇴실, 시설, 행사)
- 재학상태: 학적 변동 전반 — 휴학·복학·졸업·자퇴·군휴학, 신입생 학적 관련. 신입생 전용 공지(OT·새터·새내기 프로그램·환영회)도 여기 + targets_freshmen=true. 졸업예정자가 진로(대학원·편입 등) 결정에 참고할 모집도 포함. 세부 대상은 target_enrollment_status / targets_freshmen으로 표시. 대학원 신입생 모집은 제외 → "교내외활동" 등으로
- 시설&시스템: 도서관·전산·홈페이지 점검, 운영시간 변경, 출입 안내

## 액션 타입
- actionable: 사용자가 신청·지원·참석·제출 등 능동적 행동이 필요한 공지
- info: 정보·결과 발표·일정 안내·정책 공지 등 읽기만 해도 충분한 공지
- 판단 기준: "지금 마감일을 메모해야 하나?" YES → actionable / NO → info
- 안내성 공지(계절학기 시행, 일정 안내, 정책 변경)는 보통 info. 단 본문에 명확한 "신청"/"지원"/"제출" 요청이 있으면 actionable.

## 대상 범위 — 전체 노출 vs 소속 한정 (가장 중요)
- 학부·전공과 무관하게 **모든 대학생에게 열린 채용·인턴·공모전·대회·박람회·취업특강·세미나·강연·컨퍼런스** 공지로 특정 전공 자격 제한이 없으면: target_depts=null, target_campuses=null 로 두어 전체 학생에게 노출한다.
  단, **특정 전공에 특화된 학술 세미나·콜로퀴엄**(예: 그 학과 연구 주제 발표회)은 일반 강연이 아니므로 게시판 소속(아래)으로 한정한다.
- **캠퍼스**: 타 캠퍼스(서울/다빈치) 학생도 참여·신청할 수 있는 공지(창업·대회·채용·세미나 등 대부분)는 target_campuses=null 로 두어 양 캠퍼스 모두에 노출한다. 특정 캠퍼스에서만 진행되거나 그 캠퍼스 학생만 대상인 경우에만 해당 캠퍼스('seoul' 또는 'anseong')로 한정한다.
- 그 외 공지(학사·장학·학과 행사·시설 등)는, 입력에 '게시판 소속'이 주어지면 그 값을 target_depts에 넣어 해당 소속 학생에게만 보이게 한다. 단 본문에 더 구체적인 학과·대상이 명시되면 그것을 우선한다.
- '게시판 소속'이 입력에 없으면(전체 공지 게시판), target_depts는 본문에 학과가 명시될 때만 채운다.

## 대상 추출 규칙
- "○학년 대상" → target_grades: [숫자들]
- "○학과 대상" → target_depts: 학과명 배열 (한국어 그대로)
- 대학원생/교직원/외부인/동문 전용 → excludes_undergrad: true
- 단, 대학원·편입 신입생 모집처럼 "학사학위 취득(예정)자" 자격으로 학부 졸업예정자가 지원할 수 있는 공지는 excludes_undergrad: false (학부 4학년에게 진로 정보로서 가치)
- 특정 학적 상태 대상 → target_enrollment_status: 'enrolled'(재학)/'on_leave'(휴학)/'graduating'(졸업예정) 중 해당되는 값들의 배열. 예: 휴학생 대상→["on_leave"], 졸업예정자 모집→["graduating"]. 모든 상태 대상이면 null
- 신입생(학부 1학년·새내기) 전용 공지 → targets_freshmen: true (예: 신입생 OT, 새내기 새터, 신입생 환영회). 그 외에는 false
- 명시 안 되면 null

## 신청 일정 추출 — 시작일과 마감일을 분리해서 뽑기 (가장 흔한 실수: 시작일을 마감으로 착각)
두 개의 날짜를 따로 추출한다:
- **apply_start_at (신청 시작일)**: "○월 ○일부터", "신청 시작: ○", "○부터 신청/접수/예약 가능" 처럼
  '시작·부터'가 붙은 날짜. 시작 표현이 없으면 null.
- **deadline_at (신청 마감일)**: "○월 ○일까지", "마감: ○", "접수 종료 ○" 처럼 명시된 마감.

규칙:
- **'시작/부터'가 붙은 날짜는 절대 deadline_at으로 쓰지 말 것. 반드시 apply_start_at으로.**
  예: "신청 기간: 6.18(목)부터" → apply_start_at=6/18, deadline_at은 따로 (아래 규칙)
- **기간 "A ~ B"**: A=apply_start_at, B=deadline_at.
  예: "신청기간 6.15 ~ 6.20" → apply_start_at=6/15, deadline_at=6/20
- **마감이 "선착순 / 모집 마감까지 / 소진 시 / 충원 시 / 상시 / 클리닉(행사) 전날까지" 등
  단일 마감일이 없으면**: deadline_at = 프로그램·운영·행사 "종료일"(명확하면), 없으면 null.
  예: "신청 6.18부터, 운영 6.24~7.15, 예약은 클리닉 전날까지" → apply_start_at=6/18, deadline_at=7/15(운영 종료)
- 단발 행사(특강 등)에서 시작=참여 마감이면 deadline_at에 그 날짜.
- "초/중순/말" 등 모호 표기는 지어내지 말 것 (초≈5일, 중순≈15일, 말≈해당 월 말일 근사, 불명확하면 null).
- 두 날짜 모두 ISO 8601 + 한국시간 (예: "2026-06-15T18:00:00+09:00"). 시간 명시 없으면 18:00 가정.
  "24:00"은 다음날 00:00으로 변환.
- 절대 규칙: deadline_at은 공지 게시일보다 이르면 안 된다(이미 지난 날짜면 잘못 — null).
  apply_start_at은 게시일보다 이후가 보통이지만 과거여도 허용(이미 신청 시작된 경우).
- 추정 불가하면 각각 null.

## 요약 작성 규칙
- summary_short (40자 이내): 핵심 1줄. "○○장학금 6/15 마감" 같은 식
- summary_long (150자 이내): 핵심 정보 + 자격조건/대상/일정 압축
- 격식체, 담백하게. 광고체·과장 금지

## 본문 마크다운 재구성 (body_markdown)
분류와 별개로, 원문 본문을 모바일 가독성용 마크다운으로 재구성해 body_markdown에 담는다.
요약(summary_*)과 다름: 요약은 압축, body_markdown은 정보 손실 없이 전체 재구성.
- 첫 섹션은 반드시 "## 핵심 요약"으로 시작.
- "## 핵심 요약"은 3~4문장의 자연어로, ~해요체로 친근하게. 친구가 알려주듯 편하게 쓰되 가벼운 말투·이모지·과장은 금지.
- "## 핵심 요약"은 공지의 '본질'만 담는다 (위 마감일 영역과 본문 섹션에 디테일이 별도 표시되므로 중복 금지).
  · 포함: 공지가 무엇인지(사업/프로그램/시험 등 성격), 누가 대상인지(자격/학년/전공), 핵심 조건(성적/중복 수혜 제한 등), 금액·혜택(있으면).
  · 반드시 제외: 마감일·신청기간(상단 마감일 영역에 별도), 일정 디테일(본문 ## 📅 일정), 연락처·문의(본문 ## 문의), 신청 방법(본문 ## 신청 방법).
- 핵심 요약의 핵심 정보(자격·금액·조건 등)는 **굵게** 강조 (한 문단에 3개 이하).
- **굵게** 사용 시 안전 규칙(중요): 닫는 \`**\` 뒤에는 반드시 공백·마침표·쉼표·괄호만 올 수 있다. 한국어 글자(조사 등) 직붙 절대 금지 — 마크다운 파서(markdown-it CommonMark)가 right-flanking 규칙으로 strong을 인식 못 함.
  · 권장: 강조하고 싶은 정보는 조사·종결어미까지 포함해 \`**\` 안에 넣는다. 예: "참가비는 **60만원입니다**", "**자격은 3.0 이상**", "**신청 마감은 5/26(화)까지예요**".
  · 대안: 닫는 \`**\` 뒤 공백 분리. 예: "신청 마감은 **5/26(금)** 까지예요".
- 핵심 요약 이후엔 필요한 ## 섹션(헤더 짧게)으로 나머지 정보를 정보 손실 없이 정리 (신청방법·자격·일정·연락처 등 전부 보존). 추측·창작 없이 원문 사실만.
- 본문(핵심 요약 이후 섹션) 항목은 정보 성격별 3분기 구조로:
  · 라벨-값 쌍 (마감일/금액/장소/인원/연락처/자격 기준 등 항목-값 정보) → "- **라벨**  값" 형식 (라벨과 값 사이엔 가운뎃점(·) 쓰지 말고 공백 두 칸). 예: "- **마감**  5/15(금) 18:00", "- **금액**  최대 100만원".
  · 단순 나열 (라벨 없이 항목만 — 제출 서류/우대사항 등) → "- 항목" 형식.
  · 서술 (설명/배경/취지) → 일반 문단 (리스트 X).
- **들여쓰기 0, 중첩 리스트 금지**. 모든 리스트는 평평한 1단계로 유지.
- **말투 통일**: 모든 서술·설명 문장은 ~해요체로 끝맺는다 (~합니다/~입니다체 혼용 금지). 라벨-값·단순 나열 항목과 소제목은 명사형 그대로.
- **의미 단위 줄바꿈**: '4학년'처럼 숫자+한글이 붙은 단어나 고유명사·복합어가 줄 끝에서 '4학/년'으로 어색하게 쪼개지지 않게 한 덩어리로 둔다(필요하면 어순을 조정).
- 소제목은 명사형 + 다음 6개 이모지 앵커 매핑(해당 섹션에만 사용):
  · 📅 일정·기간·마감
  · 💰 금액·장학·등록금
  · 📍 장소·제출처
  · 👤 자격·대상
  · 📋 제출 서류
  · ⚠️ 유의사항
  매핑 외 섹션(문의/신청방법/배경 등)은 이모지 없이 명사형만. 한 공지 이모지 소제목 최대 4~5개 (모든 섹션에 붙이지 말 것). 이모지는 의미 앵커지 장식 X.
- **하위 구조는 ### 헤더로**: 한 ## 섹션 안에서 항목들을 그룹으로 묶는 소제목이 필요하면 볼드 줄(**…**)로 쓰지 말고 "### 소제목" 헤더로 작성한다. 예: "## 📋 교육 과정" 아래 각 과목은 "### 개인금융 실무 이해 (기본)". ### 소제목엔 이모지 안 붙인다.
- **헤더 앞뒤 빈 줄 필수**: 모든 ## · ### 헤더는 바로 위·아래 줄에 빈 줄을 둔다(\\n\\n으로 분리). 헤더 바로 다음 줄에 본문·리스트를 곧바로 붙이지 말 것.
- **2칸 표 사용 금지**: "항목 | 값" 식 2열 정보는 자연어 문장이나 리스트로 (예: "대상: 재학생", "마감: 5/15").
- 3칸 이상의 진짜 표(장학 단계별 일정, 다열 비교 등)는 마크다운 표 사용 OK.
- 문단 사이에는 빈 줄. URL은 원문에 있는 것만 raw로 (마크다운 링크 [..](..) 금지 — 복붙용).
- "## 핵심 요약"은 거의 모든 공지에 작성한다. 본문이 짧아도(<100자) 텍스트 정보가 조금이라도 있으면 반드시 "## 핵심 요약"으로 시작. 생략은 오직 본문이 이미지/포스터뿐이고 텍스트 정보가 거의 없는 경우만(이때는 아래 이미지/첨부 구조 사용).
- 본문이 비어 있고 이미지/첨부만 있으면 정확히 이 구조로:
## 본문
본문이 이미지로 제공됩니다. 원문에서 자세한 내용을 확인해 주세요.
## 이미지
- (이미지 1) {raw url}
## 첨부
- {raw url}
  (이미지/첨부 없으면 해당 섹션 생략. 분류용으로 이미지가 첨부돼 와도 본문을 전사하지 말고 위 안내 구조 사용)
- body_markdown은 JSON 문자열이므로 줄바꿈은 \\n 으로 이스케이프
- 재구성이 무의미하면 null

예시:
## 핵심 요약

양천장학회 특별장학금은 **평균평점 3.0/4.5 이상인** 재학생을 대상으로 **최대 100만원을** 지원해요. 다른 재단 장학금을 받고 있으면 신청할 수 없고, 등록금 전액 면제자도 지원 대상이 아니에요.

## 💰 장학 금액

- **장학금액**  최대 100만원(등록금 초과 불가)
- **수혜 횟수**  재학 중 1회만 가능

## 📅 일정

- **신청 마감**  5/15(금) 18:00
- **선발 발표**  5/22(금) 예정
- **감사편지 제출**  5/26(화)까지 (최종합격자)

## 👤 지원 자격

- **재학**  2026-1학기 등록금 납부 후 정규 학기 이수 중인 재학생
- **성적**  직전학기 평균평점 3.0/4.5 이상
- **중복 수혜**  타 재단 장학금 없음 (교내·국가장학금만 중복 OK)
- **제외**  등록금 전액 면제자

## 📋 제출 서류

- 장학회 선발원서 (첨부양식, 6개월 이내 칼라 증명사진 부착)
- 추천서 (지도교수)
- 자기소개서
- 성적증명서 (백분위)
- 등록금 납부 확인서
- 재학증명서
- 한국장학재단 학자금 지원구간 통지서
- 개인정보 수집·이용·제공·조회 동의서

## ⚠️ 유의사항

- 스테이플러 철 금지, 제출 서류 순서대로 정리
- 원본 제출 원칙 (스캔본·사진 인정 불가)
- 마감일 기준 3개월 이내 발급 서류만 인정

## 문의

- 02-820-6048
- sybae1937@cau.ac.kr

## 출력 형식
반드시 다음 JSON만 출력. 코드블록 \`\`\`json 으로 감싸기:
{
  "topic": "8개 중 하나",
  "action": "actionable" 또는 "info",
  "summary_short": "40자 이내",
  "summary_long": "150자 이내",
  "apply_start_at": "ISO 8601" 또는 null,
  "deadline_at": "ISO 8601" 또는 null,
  "target_grades": [숫자] 또는 null,
  "target_depts": ["학과명"] 또는 null,
  "target_campuses": ["seoul" 또는 "anseong"] 또는 null,
  "target_enrollment_status": ["enrolled"|"on_leave"|"graduating"] 또는 null,
  "targets_freshmen": true 또는 false,
  "target_other": "자유 텍스트" 또는 null,
  "excludes_undergrad": true 또는 false,
  "body_markdown": "## 핵심 요약\\n..." 또는 null
}`;

// deno-lint-ignore no-explicit-any
function buildUserPrompt(notice: any, hasImageOnly: boolean): string {
  const lines: string[] = [];
  lines.push("## 공지 정보");
  lines.push(`제목: ${notice.title}`);
  lines.push(`작성: ${notice.author || "(미상)"}`);
  if (notice.posted_at) lines.push(`게시일: ${notice.posted_at} (마감일은 반드시 이 날짜 이후여야 함 — 이미 지난 날짜를 마감으로 쓰지 말 것)`);
  if (notice.source_category) {
    lines.push(`학교 카테고리: ${notice.source_category}`);
    lines.push(`분류 힌트: ${topicHintForLLM(notice.source_category)}`);
  }
  if (notice.owner) {
    lines.push(`게시판 소속: ${notice.owner} (전공무관 채용·인턴·대회가 아니면 이 소속을 target_depts에 넣어 해당 학생에게만 노출)`);
  }
  if (notice.file_count > 0) {
    lines.push(`첨부파일: ${notice.file_count}개 (PDF 등 — 본문에서 못 본 마감일·자격 정보가 있을 수 있음)`);
  }
  lines.push("");
  lines.push("## 본문");
  if (hasImageOnly) {
    lines.push("(본문이 거의 없고 이미지 포스터로 구성됨. 아래 이미지를 분석해서 정보 추출)");
  } else {
    lines.push(notice.body_text || "(본문 없음)");
  }
  const imgs: string[] = notice.body_image_urls || [];
  const atts: string[] = notice.attachment_urls || [];
  if (imgs.length) {
    lines.push("");
    lines.push("## 본문 이미지 URL");
    imgs.forEach((u, i) => lines.push(`(이미지 ${i + 1}) ${u}`));
  }
  if (atts.length) {
    lines.push("");
    lines.push("## 첨부파일 URL");
    atts.forEach((u) => lines.push(u));
  }
  lines.push("");
  lines.push("위 정보로 JSON 출력하세요.");
  return lines.join("\n");
}

// deno-lint-ignore no-explicit-any
function extractJson(text: string): any | null {
  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = block ? block[1] : text;
  const match = candidate.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

// deno-lint-ignore no-explicit-any
function validateAndFix(obj: any): void {
  if (!TOPICS.includes(obj.topic)) throw new Error(`Invalid topic: ${obj.topic}`);
  if (!["actionable", "info"].includes(obj.action)) throw new Error(`Invalid action: ${obj.action}`);
  if (obj.summary_short?.length > 60) obj.summary_short = obj.summary_short.slice(0, 60);
  if (obj.summary_long?.length > 200) obj.summary_long = obj.summary_long.slice(0, 200);
  for (const k of ["apply_start_at", "deadline_at", "target_grades", "target_depts", "target_campuses", "target_enrollment_status", "target_other"]) {
    if (obj[k] === undefined) obj[k] = null;
  }
  const ALLOWED_ENROLLMENT = ["enrolled", "on_leave", "graduating"];
  if (Array.isArray(obj.target_enrollment_status)) {
    const filtered = obj.target_enrollment_status.filter((s: string) => ALLOWED_ENROLLMENT.includes(s));
    obj.target_enrollment_status = filtered.length ? filtered : null;
  } else {
    obj.target_enrollment_status = null;
  }
  obj.targets_freshmen = obj.targets_freshmen === true;
  if (obj.deadline_at && typeof obj.deadline_at === "string") {
    const m = obj.deadline_at.match(/^(\d{4}-\d{2}-\d{2})T24:00:(\d{2})(.*)$/);
    if (m) {
      const nextDay = new Date(m[1] + "T00:00:00Z");
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const y = nextDay.getUTCFullYear();
      const mo = String(nextDay.getUTCMonth() + 1).padStart(2, "0");
      const d = String(nextDay.getUTCDate()).padStart(2, "0");
      obj.deadline_at = `${y}-${mo}-${d}T00:00:${m[2]}${m[3]}`;
    }
  }
  if (obj.deadline_at && typeof obj.deadline_at === "string") {
    const dl = new Date(obj.deadline_at);
    const threshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    if (!isNaN(dl.getTime()) && dl < threshold) obj.deadline_at = null;
  }
  obj.excludes_undergrad = obj.excludes_undergrad === true;
  if (typeof obj.body_markdown !== "string" || obj.body_markdown.trim() === "") obj.body_markdown = null;
}

async function fetchImageAsBase64(url: string): Promise<{ mediaType: string; base64: string } | null> {
  const MAX_BYTES = 4.5 * 1024 * 1024;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NOTICAU/0.1)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const inputType = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(inputType)) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return null; // sharp 없음 → 리사이즈 대신 스킵(텍스트 fallback)
    return { mediaType: inputType, base64: encodeBase64(buf) };
  } catch {
    return null;
  }
}

// deno-lint-ignore no-explicit-any
async function classifyNotice(notice: any) {
  const hasImageOnly = (notice.body_text || "").trim().length < 200 && (notice.body_image_urls?.length ?? 0) > 0;

  let imgData: { mediaType: string; base64: string } | null = null;
  if (hasImageOnly && notice.body_image_urls[0]) {
    imgData = await fetchImageAsBase64(notice.body_image_urls[0]);
  }
  const useImage = !!imgData;

  // deno-lint-ignore no-explicit-any
  const content: any[] = [{ type: "text", text: buildUserPrompt(notice, useImage) }];
  if (useImage && imgData) {
    content.push({ type: "image", source: { type: "base64", media_type: imgData.mediaType, data: imgData.base64 } });
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // prompt caching: 거대한 시스템 프롬프트를 캐시 → 배치 내 2번째 호출부터 입력 토큰 대폭 절감
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content }],
      });
      // 출력이 잘렸으면 JSON이 불완전 → 재시도해도 또 잘림. 재시도 없이 즉시 실패 처리.
      if (response.stop_reason === "max_tokens") {
        throw new TruncationError(`output truncated at max_tokens=${MAX_TOKENS}`);
      }
      const text = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
      const parsed = extractJson(text);
      if (!parsed) throw new Error(`LLM did not return valid JSON: ${text.slice(0, 200)}`);
      validateAndFix(parsed);
      // 가드: 마감일이 게시일보다 이르면(게시 시점에 이미 지난 마감) 오추출로 보고 무효화.
      if (parsed.deadline_at && notice.posted_at) {
        const dl = new Date(parsed.deadline_at);
        const posted = new Date(notice.posted_at);
        if (!isNaN(dl.getTime()) && !isNaN(posted.getTime()) && dl < posted) parsed.deadline_at = null;
      }
      return { ...parsed, has_image_content: hasImageOnly, llm_model: MODEL };
    } catch (err) {
      lastErr = err;
      if (err instanceof TruncationError) break; // 재시도 무의미 → 낭비 차단
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastErr;
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const auth = req.headers.get("Authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let batch = DEFAULT_BATCH;
  try {
    const body = await req.json();
    if (body && Number.isInteger(body.batch) && body.batch > 0) batch = Math.min(body.batch, 30);
  } catch { /* cron 빈 body */ }

  const { data: notices, error: qErr } = await supabase.rpc("notices_unclassified", { lim: batch });
  if (qErr) {
    return new Response(JSON.stringify({ error: qErr.message }), { status: 500 });
  }

  // 게시판 소속(owner): 학과·단과대 게시판의 '소속'. 전공무관 채용·인턴·대회 공지는
  // 전체 노출하고, 그 외 공지는 이 소속 학생에게만 보이도록 LLM이 판단(SYSTEM_PROMPT 규칙).
  // 소속 없는 출처(본교·산학협력단·공학교육혁신센터 등)는 본문 명시 학과만 한정 → 사실상 전체.
  const SOURCE_OWNER: Record<string, string> = {
    cau_econ: "경제학부",
    cau_biz: "경영학부",
    cau_biz_career: "경영학부",
    cau_bne: "경영경제대학",
    cau_stat: "응용통계학과",
    cau_adpr: "광고홍보학부",
    cau_security: "산업보안학과",
    cau_log: "국제물류학과",
  };
  const { data: allSrc } = await supabase.from("sources").select("id,parser_key,owner_unit");
  const ownerBySourceId = new Map<string, string>();
  const ownerUnitBySourceId = new Map<string, string>(); // 게시판 소속 코드(dept/college)
  for (const s of (allSrc ?? []) as { id: string; parser_key: string; owner_unit: string | null }[]) {
    const o = SOURCE_OWNER[s.parser_key];
    if (o) ownerBySourceId.set(s.id, o);
    if (s.owner_unit) ownerUnitBySourceId.set(s.id, s.owner_unit);
  }

  // 학과/단과대 이름→코드 맵: target_depts를 코드로 정규화해 앱의 profile(코드)과 직접 비교 가능하게.
  const [{ data: depts }, { data: colls }] = await Promise.all([
    supabase.from("departments").select("code,name"),
    supabase.from("colleges").select("code,name"),
  ]);
  const nameToCode = new Map<string, string>();
  const collegeCodes = new Set<string>();
  for (const c of (colls ?? []) as { code: string; name: string }[]) { nameToCode.set(c.name, c.code); collegeCodes.add(c.code); }
  for (const d of (depts ?? []) as { code: string; name: string }[]) nameToCode.set(d.name, d.code); // 학과가 단과대명과 겹치면 학과 우선

  const stats = { fetched: (notices ?? []).length, classified: 0, failed: 0 };
  const results: { id: string; topic?: string; error?: string }[] = [];

  for (const n of notices ?? []) {
    // 처리 시작 시 시도 횟수 +1. 타임아웃/크래시로 catch에 못 들어가도 카운트되어
    // RPC의 classify_attempts<3 가드가 작동 → 무한 재시도(비용 폭탄) 원천 차단.
    await supabase.from("notices")
      .update({ classify_attempts: (n.classify_attempts ?? 0) + 1 })
      .eq("id", n.id);
    try {
      const meta = await classifyNotice({
        title: n.title,
        author: n.author,
        body_text: n.body_text,
        body_image_urls: n.body_image_urls,
        attachment_urls: n.attachment_urls,
        source_category: n.source_category,
        posted_at: n.posted_at,
        file_count: (n.attachment_urls?.length ?? 0),
        owner: ownerBySourceId.get(n.source_id) ?? null,
      });
      // target_depts 이름 → 코드 정규화(매칭 안 되는 이름은 드롭, 전부 드롭이면 null=전체노출)
      if (Array.isArray(meta.target_depts)) {
        const codes = meta.target_depts.map((nm: string) => nameToCode.get(nm)).filter(Boolean) as string[];
        meta.target_depts = codes.length ? [...new Set(codes)] : null;
      }
      // 단과대 게시판의 학과 한정 공지는 단과대 전체(college)로 정규화 — 본문에 일부 학과만
      // 나열돼도 그 단과대 학생 전원에게 노출(일부 학과 누락 방지). 전체대상(null)은 그대로.
      const ou = ownerUnitBySourceId.get(n.source_id);
      if (ou && collegeCodes.has(ou) && Array.isArray(meta.target_depts) && meta.target_depts.length > 0) {
        meta.target_depts = [ou];
      }
      const { error: upErr } = await supabase.from("notice_meta").upsert({ notice_id: n.id, ...meta });
      if (upErr) throw upErr;
      await supabase.from("notices").update({ classify_last_error: null }).eq("id", n.id);
      stats.classified++;
      results.push({ id: n.id, topic: meta.topic });
    } catch (e) {
      const msg = String((e as Error).message).slice(0, 500);
      await supabase.from("notices").update({ classify_last_error: msg }).eq("id", n.id);
      stats.failed++;
      results.push({ id: n.id, error: msg.slice(0, 200) });
      console.error(`classify ${n.id} failed: ${msg}`);
    }
  }

  return new Response(JSON.stringify({ ...stats, results }), { headers: { "Content-Type": "application/json" } });
});
