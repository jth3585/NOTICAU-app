// export_signups_sheet — 전체 가입자 현황을 Google Sheets에 매일 덮어쓰기.
// 온보딩 미완료(profiles 행 없음) 가입자도 포함하며, "온보딩" 칼럼으로 구분한다.
// (cron: '0 0 * * *' UTC = 09:00 KST)
//
// 인증: verify_jwt=false 로 배포 + Authorization: Bearer <CRON_SECRET> 자체 검증.
// 시트는 매번 전체 스냅샷으로 clear 후 재작성 → 탈퇴/프로필 수정이 그대로 반영됨(이력 누적 아님).
//
// 필요한 secrets:
//   GOOGLE_SA_EMAIL          서비스 계정 이메일 (xxx@yyy.iam.gserviceaccount.com)
//   GOOGLE_SA_PRIVATE_KEY    서비스 계정 JSON의 private_key (\n 이스케이프 그대로 넣어도 됨)
//   SHEETS_SPREADSHEET_ID    시트 URL의 /d/<이 부분>/edit
//   SHEETS_TAB               (선택) 탭 이름. 기본 "가입자"

import { createClient } from "jsr:@supabase/supabase-js@2";
import { importPKCS8, SignJWT } from "npm:jose@5";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

type Row = {
  user_id: string;
  joined_at: string;
  nickname: string | null;
  onboarded: boolean;
  college_name: string | null;
  dept_name: string | null;
  dept_secondary_name: string | null;
  grade: number | null;
  campus: string | null;
  enrollment_status: string[] | null;
  is_dormitory: boolean | null;
  career_paths: string[] | null;
  notifications_enabled: boolean | null;
  keyword_count: number;
  keywords: string | null;
  bookmark_count: number;
  last_active_at: string | null;
};

// ---- 표시 포맷 ----
const CAMPUS_LABEL: Record<string, string> = { seoul: "서울", davinci: "다빈치" };
const STATUS_LABEL: Record<string, string> = {
  enrolled: "재학",
  on_leave: "휴학",
  graduating: "졸업예정",
};

// "2026-08-15 18:57" (KST). 시트에서 정렬되도록 ISO 유사 형태 유지.
function kst(iso: string | null): string {
  if (!iso) return "";
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`;
}

function daysAgo(iso: string | null): string {
  if (!iso) return "";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d === 0 ? "오늘" : `${d}일 전`;
}

// ---- Google 서비스 계정 → 액세스 토큰 ----
async function getAccessToken(): Promise<string> {
  const email = Deno.env.get("GOOGLE_SA_EMAIL");
  const rawKey = Deno.env.get("GOOGLE_SA_PRIVATE_KEY");
  if (!email || !rawKey) throw new Error("GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY 미설정");

  // secrets에 한 줄로 넣으면 개행이 \n 문자열로 들어옴 → 실제 개행으로 복원.
  const key = await importPKCS8(rawKey.replace(/\\n/g, "\n"), "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/spreadsheets" })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(email)
    .setAudience(TOKEN_URL)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`token 발급 실패: ${JSON.stringify(json)}`);
  return json.access_token as string;
}

Deno.serve(async (req) => {
  // ---- 인증 ----
  const cronSecret = Deno.env.get("CRON_SECRET");
  const auth = req.headers.get("Authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const spreadsheetId = Deno.env.get("SHEETS_SPREADSHEET_ID");
  if (!spreadsheetId) {
    return new Response(JSON.stringify({ error: "SHEETS_SPREADSHEET_ID 미설정" }), { status: 500 });
  }
  const tab = Deno.env.get("SHEETS_TAB") ?? "가입자";

  // ---- 데이터 조회 ----
  const { data, error } = await supabase.rpc("signups_export");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
  const rows = (data ?? []) as Row[];

  // ---- 시트 값 구성 ----
  const header = [
    "가입일시(KST)",
    "닉네임",
    "온보딩",
    "단과대",
    "학과",
    "복수/부전공",
    "학년",
    "캠퍼스",
    "재학상태",
    "기숙사",
    "진로",
    "알림",
    "키워드 수",
    "키워드",
    "스크랩 수",
    "최근 활동",
    "user_id",
  ];
  const body = rows.map((r) => [
    kst(r.joined_at),
    r.nickname ?? "",
    r.onboarded ? "완료" : "미완료",
    r.college_name ?? "",
    r.dept_name ?? "",
    r.dept_secondary_name ?? "",
    r.grade ?? "",
    r.campus ? CAMPUS_LABEL[r.campus] ?? r.campus : "",
    (r.enrollment_status ?? []).map((s) => STATUS_LABEL[s] ?? s).join(", "),
    r.is_dormitory ? "O" : "",
    (r.career_paths ?? []).join(", "),
    r.notifications_enabled == null ? "" : (r.notifications_enabled ? "on" : "off"),
    r.keyword_count,
    r.keywords ?? "",
    r.bookmark_count,
    daysAgo(r.last_active_at),
    r.user_id,
  ]);
  const values = [
    [`마지막 갱신: ${kst(new Date().toISOString())} KST · 총 ${rows.length}명`],
    header,
    ...body,
  ];

  // ---- 시트 갱신 (clear → update) ----
  const token = await getAccessToken();
  const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const range = encodeURIComponent(`${tab}!A:Z`);

  const clearRes = await fetch(`${SHEETS_API}/${spreadsheetId}/values/${range}:clear`, {
    method: "POST",
    headers: authHeaders,
  });
  if (!clearRes.ok) {
    return new Response(
      JSON.stringify({ error: "sheet clear 실패", detail: await clearRes.text() }),
      { status: 500 },
    );
  }

  // RAW: 닉네임/키워드는 유저 입력이라 "=..." 로 시작하면 수식으로 실행될 수 있음(수식 인젝션).
  // RAW는 파싱 없이 문자열로 저장하므로 안전. 날짜는 텍스트지만 "YYYY-MM-DD HH:MM"이라 정렬은 정상.
  const updRange = encodeURIComponent(`${tab}!A1`);
  const updRes = await fetch(
    `${SHEETS_API}/${spreadsheetId}/values/${updRange}?valueInputOption=RAW`,
    { method: "PUT", headers: authHeaders, body: JSON.stringify({ values }) },
  );
  if (!updRes.ok) {
    return new Response(
      JSON.stringify({ error: "sheet update 실패", detail: await updRes.text() }),
      { status: 500 },
    );
  }

  return new Response(
    JSON.stringify({ synced_users: rows.length, tab, updated_at: new Date().toISOString() }),
    { headers: { "Content-Type": "application/json" } },
  );
});
