import * as Haptics from 'expo-haptics';

// 햅틱 래퍼. 미지원 환경/에러 시 조용히 무시 (graceful).
export function lightHaptic() {
  try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
}

export function successHaptic() {
  try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
}

// 이미 처리된(중복) 동작 등 "변화 없음" 피드백.
export function softHaptic() {
  try { Haptics.selectionAsync(); } catch {}
}

// 삭제/되돌림 등 주의가 필요한 동작 피드백.
export function warningHaptic() {
  try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
}
