import { useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';

// 활성 탭을 다시 눌렀을 때(tabPress + 이미 focus 상태)만 onReselect 실행.
// 다른 탭에서 이 탭으로 '진입'하는 경우엔 아직 focus 전이라 실행되지 않는다.
// 스크롤 맨 위로는 별도로 useScrollToTop(ref)을 함께 쓴다(여기선 새로고침 용도).
export function useTabReselect(onReselect: () => void) {
  const navigation = useNavigation<any>();
  useEffect(() => {
    const unsub = navigation.addListener('tabPress', () => {
      if (navigation.isFocused()) onReselect();
    });
    return unsub;
  }, [navigation, onReselect]);
}
