import { COLORS } from '../lib/theme';
import { BookmarkIcon } from './ui/BookmarkIcon';
import { SwipeAction } from './SwipeAction';

type Props = {
  alreadyBookmarked: boolean;
  onBookmark: () => void;  // 미북마크 상태에서 임계값 넘김 → 추가
  onAlready: () => void;   // 이미 북마크된 상태에서 스와이프 → 피드백만
  children: React.ReactNode;
};

// 카드를 좌→우로 스와이프하면 좌측에 북마크 액션이 드러나고, 임계값을 넘겨 손을 떼면
// 북마크 추가(또는 이미 북마크면 피드백만). 공용 SwipeAction 위에 라벨/색만 입힌다.
export function SwipeToBookmark({ alreadyBookmarked, onBookmark, onAlready, children }: Props) {
  return (
    <SwipeAction
      color={alreadyBookmarked ? COLORS.textTertiary : COLORS.accent}
      icon={<BookmarkIcon size={22} filled color="#fff" />}
      label={alreadyBookmarked ? '북마크됨' : '북마크'}
      onTrigger={alreadyBookmarked ? onAlready : onBookmark}
    >
      {children}
    </SwipeAction>
  );
}
