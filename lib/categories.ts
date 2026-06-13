import { CHIP_TOPICS } from './constants';

// '전체' 제외한 카테고리 (편집/정렬 대상)
export const CATEGORIES = CHIP_TOPICS.filter((t) => t !== '전체') as string[];

export type CategoryPrefRow = { topic: string; is_enabled?: boolean; sort_order?: number | null };

// 사용자 정렬(sort_order)을 반영한 카테고리 순서. 정렬 기록이 없으면 기본(CATEGORIES) 순서.
export function orderedCategories(rows: CategoryPrefRow[]): string[] {
  const hasOrder = rows.some((r) => r.sort_order != null);
  if (!hasOrder) return [...CATEGORIES];
  const order = new Map(rows.map((r) => [r.topic, r.sort_order ?? 999] as const));
  return [...CATEGORIES].sort(
    (a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999),
  );
}
