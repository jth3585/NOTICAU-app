import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../../lib/theme';
import { CalendarIcon, CheckIcon, TrashIcon } from './icons';
import { addNoticeToCalendar, getSavedEventId, removeNoticeFromCalendar } from '../../lib/calendar';
import { successHaptic, warningHaptic } from '../../lib/haptics';
import type { Notice } from '../../lib/types';

// 해제 직후 빨간 "삭제됨"을 보여주는 시간(ms). 이후 기본 상태로 부드럽게 복귀.
const REMOVED_FLASH_MS = 900;

// 공지 마감일을 기기 캘린더에 추가/해제하는 토글 버튼.
// 마감일이 있을 때만 상세화면에서 렌더. eventId 로컬 매핑으로 상태 복원.
// 추가됨 상태에서 다시 누르면 잠깐 빨갛게 "삭제됨"을 보여준 뒤 기본 상태로 페이드한다.
export function AddToCalendarButton({ notice, deadlineAt }: { notice: Notice; deadlineAt: string }) {
  const [added, setAdded] = useState(false);
  const [busy, setBusy] = useState(false);
  // 해제 직후 잠깐 빨갛게 "삭제됨"을 보여주는 일시 상태.
  const [removedFlash, setRemovedFlash] = useState(false);

  // 0 = 기본(파랑), 1 = 빨강. 색 보간이라 네이티브 드라이버 사용 불가.
  const redAnim = useRef(new Animated.Value(0)).current;
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    getSavedEventId(notice.id).then((id) => { if (alive) setAdded(!!id); });
    return () => { alive = false; };
  }, [notice.id]);

  // 언마운트 시 타이머 정리.
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  // 빨간 잔상/타이머를 즉시 제거하고 기본 상태로 되돌린다.
  const clearFlash = () => {
    if (flashTimer.current) { clearTimeout(flashTimer.current); flashTimer.current = null; }
    setRemovedFlash(false);
    redAnim.setValue(0);
  };

  const onPress = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (added) {
        await removeNoticeFromCalendar(notice.id);
        setAdded(false);
        // 빨간 "삭제됨" 플래시를 띄우고, REMOVED_FLASH_MS 후 기본 상태로 부드럽게 페이드.
        setRemovedFlash(true);
        redAnim.setValue(1);
        warningHaptic();
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => {
          setRemovedFlash(false);
          Animated.timing(redAnim, {
            toValue: 0,
            duration: 450,
            easing: Easing.out(Easing.quad),
            useNativeDriver: false,
          }).start();
        }, REMOVED_FLASH_MS);
      } else {
        // 플래시 도중 다시 누르면 곧바로 재추가 — 빨강 잔상 제거.
        clearFlash();
        const res = await addNoticeToCalendar(notice, deadlineAt);
        if (res.ok) {
          setAdded(true);
          successHaptic();
        } else if (res.reason === 'permission') {
          Alert.alert(
            '캘린더 권한 필요',
            '설정에서 NOTICAU의 캘린더 접근을 허용해주세요.',
            [{ text: '취소', style: 'cancel' }, { text: '설정 열기', onPress: () => Linking.openSettings() }],
          );
        } else if (res.reason === 'no-calendar') {
          Alert.alert('캘린더 없음', '추가할 수 있는 캘린더를 찾지 못했습니다.');
        } else {
          Alert.alert('추가 실패', '캘린더에 추가하지 못했습니다. 잠시 후 다시 시도해주세요.');
        }
      }
    } finally {
      setBusy(false);
    }
  };

  // added가 아닐 때만 색을 파랑↔빨강으로 보간. added는 정적(파랑 채움) 스타일.
  const borderColor = redAnim.interpolate({ inputRange: [0, 1], outputRange: [COLORS.accent, COLORS.danger] });
  const backgroundColor = redAnim.interpolate({ inputRange: [0, 1], outputRange: [COLORS.surface, COLORS.dangerSoft] });
  const textColor = redAnim.interpolate({ inputRange: [0, 1], outputRange: [COLORS.accent, COLORS.danger] });
  const containerStyle = added
    ? { borderColor: COLORS.accentSoft, backgroundColor: COLORS.accentSoft }
    : { borderColor, backgroundColor };

  return (
    <Animated.View style={[styles.btn, containerStyle]}>
      <TouchableOpacity onPress={onPress} disabled={busy} activeOpacity={0.7} style={styles.inner}>
        <View style={styles.iconBox}>
          {busy ? (
            <ActivityIndicator size="small" color={added ? COLORS.accentText : COLORS.accent} />
          ) : added ? (
            <CheckIcon size={18} color={COLORS.accentText} />
          ) : removedFlash ? (
            <TrashIcon size={18} color={COLORS.danger} />
          ) : (
            <CalendarIcon size={18} color={COLORS.accent} />
          )}
        </View>
        <View style={styles.labelBox}>
          {/* 폭 고정용 투명 sizer(가장 긴 라벨) — 세 상태 박스 크기 통일 */}
          <Text style={[styles.text, styles.labelSizer]} numberOfLines={1}>캘린더에 추가됨</Text>
          {added ? (
            <Text style={[styles.text, styles.textAdded, styles.labelOverlay]} numberOfLines={1}>캘린더에 추가됨</Text>
          ) : (
            <Animated.Text style={[styles.text, styles.labelOverlay, { color: textColor }]} numberOfLines={1}>
              {removedFlash ? '삭제됨' : '캘린더에 추가'}
            </Animated.Text>
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btn: {
    alignSelf: 'flex-start',
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    marginBottom: SPACING.sm,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  text: { fontSize: FONT.caption, fontWeight: WEIGHT.bold, color: COLORS.accent, lineHeight: 18 },
  textAdded: { color: COLORS.accentText },
  // 고정 높이 — 상태별 아이콘(18~20px)/스피너 높이 차이로 버튼이 흔들려 아래 요소가 밀리는 것 방지
  iconBox: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  labelBox: { height: 18, justifyContent: 'center' },
  labelSizer: { opacity: 0 }, // 폭만 차지하고 보이지 않음
  labelOverlay: { position: 'absolute', left: 0, right: 0, textAlign: 'center' },
});
