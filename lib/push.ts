import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { supabase } from './supabase';

// 앱이 포그라운드일 때 알림 표시 방식.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// 권한 요청 + Expo Push token 발급.
// 실기기가 아니거나 projectId 미설정(eas init 전)이면 null 반환 — 앱 안 죽음.
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn('[push] 실기기가 아니라 푸시 토큰 발급 생략');
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.warn('[push] 알림 권한 거부됨');
    return null;
  }

  const projectId =
    Constants?.expoConfig?.extra?.eas?.projectId ??
    (Constants as any)?.easConfig?.projectId;
  if (!projectId) {
    console.warn('[push] EAS projectId 없음 (eas init 필요) — 토큰 발급 생략');
    return null;
  }

  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    return token;
  } catch (e) {
    console.warn('[push] 토큰 발급 실패', e);
    return null;
  }
}

// push_tokens 테이블에 upsert (PK: token).
export async function savePushToken(token: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const { error } = await supabase.from('push_tokens').upsert(
    {
      token,
      user_id: session.user.id,
      platform,
      is_active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'token' }
  );
  if (error) console.warn('[push] 토큰 저장 실패', error.message);
}

// 편의: 등록 + 저장 한 번에. 실패해도 throw 안 함.
export async function setupPushNotifications(): Promise<void> {
  try {
    const token = await registerForPushNotificationsAsync();
    if (token) await savePushToken(token);
  } catch (e) {
    console.warn('[push] setup 실패', e);
  }
}
