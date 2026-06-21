import type { Notice, NoticeMeta, Profile, Source, UserKeyword } from './types';
import { sourceOf } from './format';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 키워드 매칭: 영문/숫자로만 된 키워드는 단어 경계(\b)로 정밀 매칭하여
// 영어 단어 내부 부분일치 오탐 방지("ai"가 "Detailed"에 걸리는 문제).
// 한글이 섞인 키워드는 조사·합성어 때문에 기존 substring 매칭 유지("장학"→"장학금").
// haystack 은 이미 lower-case 되어 있다고 가정.
export function matchKeyword(haystack: string, keyword: string): boolean {
  const kw = keyword.toLowerCase();
  if (/^[a-z0-9]+$/i.test(keyword)) {
    return new RegExp(`\\b${escapeRegex(kw)}\\b`, 'i').test(haystack);
  }
  return haystack.includes(kw);
}

const SOURCE_SCORE: Record<string, number> = {
  cau_biz: 35,
  cau_bne: 25,
  cau_main: 15,
};

// davinci 사용자는 target_campuses의 'anseong'도 매칭
function campusMatch(profile: Profile, targetCampuses: string[]): boolean {
  if (targetCampuses.includes(profile.campus)) return true;
  if (profile.campus === 'davinci' && targetCampuses.includes('anseong')) return true;
  return false;
}

// 출처(게시판) 자체의 캠퍼스 귀속 검사. 'both'(본교)·null은 모든 캠퍼스 통과.
// source.campus는 'seoul'|'anseong'|'both', profile.campus는 'seoul'|'davinci'.
function sourceCampusMatch(profile: Profile, sourceCampus: string): boolean {
  if (sourceCampus === profile.campus) return true;
  if (sourceCampus === 'anseong' && profile.campus === 'davinci') return true;
  return false;
}

export function isMismatch(
  notice: Notice,
  meta: NoticeMeta | null,
  profile: Profile,
  disabledTopics: Set<string>,
  readIds: Set<string>,
): boolean {
  // 이미 읽음
  if (readIds.has(notice.id)) return true;

  // 출처(게시판) 캠퍼스 귀속: 특정 캠퍼스 게시판인데 내 캠퍼스가 아니면 제외.
  // 'both'(본교)는 통과 — 그 안의 캠퍼스별 공지는 아래 target_campuses로 한 번 더 거른다.
  // (meta가 없어도 적용되는 가장 확실한 신호이므로 meta 체크보다 위에 둔다.)
  const src = sourceOf(notice);
  if (src?.campus && src.campus !== 'both' && !sourceCampusMatch(profile, src.campus)) return true;

  if (!meta) return false;

  // 카테고리 OFF
  if (meta.topic && disabledTopics.has(meta.topic)) return true;

  // 학년 명시 + 본인 포함 안 됨
  if (meta.target_grades && meta.target_grades.length > 0 && !meta.target_grades.includes(profile.grade)) return true;

  // 캠퍼스 명시 + 본인 포함 안 됨
  if (meta.target_campuses && meta.target_campuses.length > 0 && !campusMatch(profile, meta.target_campuses)) return true;

  // 재학상태 명시 + 교집합 없음
  if (meta.target_enrollment_status && meta.target_enrollment_status.length > 0) {
    const userStatuses = new Set(profile.enrollment_status);
    if (!meta.target_enrollment_status.some(s => userStatuses.has(s))) return true;
  }

  // 신입생 대상 + 본인 1학년 아님
  if (meta.targets_freshmen && profile.grade !== 1) return true;

  // 학부 제외 공지
  if (meta.excludes_undergrad) return true;

  // 기숙사 카테고리 + 비기숙사 사용자
  if (meta.topic === '기숙사' && !profile.is_dormitory) return true;

  return false;
}

export function calculateMatchScore(
  notice: Notice,
  meta: NoticeMeta | null,
  profile: Profile,
  keywords: UserKeyword[],
  source: Source | null,
): number {
  let score = 0;

  // 1. 키워드 매칭 (0~35)
  if (keywords.length > 0) {
    const haystack = `${notice.title} ${notice.body_text ?? ''}`.toLowerCase();
    let matched = 0;
    for (const kw of keywords) {
      if (matchKeyword(haystack, kw.keyword)) matched++;
      if (matched >= 2) break;
    }
    if (matched >= 2) score += 35;
    else if (matched === 1) score += 20;
  }

  // 2. 소스/학과 매칭 (0~35)
  const sourceKey = source?.parser_key ?? '';
  let srcScore = SOURCE_SCORE[sourceKey] ?? 0;
  if (profile.dept && meta?.target_depts?.includes(profile.dept)) {
    srcScore = Math.min(35, srcScore + 5);
  }
  score += srcScore;

  // 3. 마감 임박 (0~15)
  if (meta?.deadline_at) {
    const days = (new Date(meta.deadline_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (days >= 0 && days <= 3) score += 15;
    else if (days > 3 && days <= 7) score += 10;
    else if (days > 7 && days <= 14) score += 5;
  }

  // 4. 행동 학습 (0, 예약)
  // score += 0;

  return score;
}
