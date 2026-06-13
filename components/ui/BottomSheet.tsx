import { useEffect, useRef, useState } from 'react';
import {
  Animated, KeyboardAvoidingView, Modal, Platform, StyleSheet, TouchableWithoutFeedback, View,
} from 'react-native';

const SHEET_OFFSET = 800; // 시트가 아래에서 올라오는 시작 거리 (시트 높이보다 충분히 큼)

// 공용 바텀시트: 백드롭은 제자리에서 페이드인, 시트만 아래에서 슬라이드업
// (둘이 함께 올라오지 않게). 앞으로 올라오는 시트류는 전부 이걸로 통일.
export function BottomSheet({
  visible, onClose, children, avoidKeyboard = false,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  avoidKeyboard?: boolean;
}) {
  const [mounted, setMounted] = useState(visible);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(anim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    } else {
      Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, anim]);

  if (!mounted) return null;

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [SHEET_OFFSET, 0] });

  const sheet = (
    <Animated.View style={{ transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        <TouchableWithoutFeedback onPress={onClose}>
          <Animated.View style={[styles.backdrop, { opacity: anim }]} />
        </TouchableWithoutFeedback>
        {avoidKeyboard ? (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {sheet}
          </KeyboardAvoidingView>
        ) : sheet}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
});
