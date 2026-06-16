import { COLORS } from '../lib/theme';
import { TrashIcon } from './ui/icons';
import { SwipeAction } from './SwipeAction';

type Props = {
  onRemove: () => void; // 임계값 넘김 → 북마크 삭제
  children: React.ReactNode;
};

// 북마크 화면에서 카드를 좌→우로 스와이프하면 삭제. 추가(SwipeToBookmark)와 동일한
// 공용 SwipeAction 로직을 그대로 사용 — 색/아이콘/라벨만 삭제용으로 교체.
export function SwipeToRemoveBookmark({ onRemove, children }: Props) {
  return (
    <SwipeAction
      color={COLORS.danger}
      icon={<TrashIcon size={22} color="#fff" />}
      label="삭제"
      onTrigger={onRemove}
    >
      {children}
    </SwipeAction>
  );
}
