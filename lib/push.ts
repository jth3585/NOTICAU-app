import { Linking, Platform } from 'react-native';
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

// Android 알림 채널. 서버(supabase/functions/_shared/push.ts)가 보내는 channelId 와 같아야 한다 —
// 기기에 없는 채널 id 로 오면 Android 는 알림을 표시하지 않는다.
// 사용자는 기기 설정에서 채널(종류)별로 알림을 끌 수 있다. 한 번 만든 채널은 이름·설명만 바뀐다.
const ANDROID_CHANNELS: { id: string; name: string; description: string; importance: Notifications.AndroidImportance }[] = [
  { id: 'keyword', name: '키워드 알림', description: '등록한 키워드가 담긴 새 공지', importance: Notifications.AndroidImportance.HIGH },
  { id: 'event', name: '행사 알림', description: '내 학과·단과대의 새 행사', importance: Notifications.AndroidImportance.HIGH },
  { id: 'digest', name: '오늘의 공지 브리핑', description: '매일 저녁 6시, 그날 올라온 내 공지', importance: Notifications.AndroidImportance.DEFAULT },
  { id: 'default', name: '기타 알림', description: '그 밖의 알림', importance: Notifications.AndroidImportance.DEFAULT },
];

// Android 13+ 는 채널이 하나라도 있어야 권한 창이 뜨고, 토큰 발급 전에도 채널이 있어야 한다 → 가장 먼저 부른다.
export async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Promise.all(ANDROID_CHANNELS.map(({ id, ...ch }) =>
    Notifications.setNotificationChannelAsync(id, { ...ch, vibrationPattern: [0, 250, 250, 250], lightColor: '#4A90E2' }),
  ));
}

export type PushPermission = {
  granted: boolean;
  undetermined: boolean; // 아직 한 번도 묻지 않음
  canAskAgain: boolean; // false 면 기기 설정에서만 켤 수 있다
};

export async function getPushPermission(): Promise<PushPermission> {
  const p = await Notifications.getPermissionsAsync();
  const provisional = p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  return { granted: p.granted || provisional, undetermined: p.status === 'undetermined', canAskAgain: p.canAskAgain };
}

// 시스템 권한 창을 띄운다. 이미 거절해 다시 물을 수 없으면 창 없이 현재 상태만 돌려준다.
export async function requestPushPermission(): Promise<PushPermission> {
  await ensureAndroidChannels();
  await Notifications.requestPermissionsAsync();
  return getPushPermission();
}

export function openDeviceNotificationSettings(): void {
  Linking.openSettings().catch(() => {});
}

// 마지막으로 받은 기기 토큰(APNs/FCM). 토큰 변경 이벤트가 같은 토큰으로 오면 무시하는 데 쓴다.
let lastDeviceToken: string | null = null;
// 진행 중인 setup 수. expo-notifications 는 기기 토큰을 '받는' 것만으로도 토큰 변경 이벤트를 쏜다
// (iOS: 등록할 때마다 didRegister, Android: getDevicePushTokenAsync 끝에 onNewToken). 그래서 우리가
// 토큰을 받는 중에 온 이벤트에 다시 setup 으로 반응하면 끝없이 돈다 → 진행 중이면 이벤트를 무시한다.
let setupsInFlight = 0;

function deviceTokenString(t: Notifications.DevicePushToken): string {
  return typeof t.data === 'string' ? t.data : JSON.stringify(t.data);
}

// Expo Push token 발급. 오프라인 등으로 실패할 수 있어 한 번 더 시도한다.
// 기기 토큰을 먼저 받아 기억해 두고, Expo 토큰 발급에 그대로 넘긴다(기기 토큰을 두 번 받지 않게).
async function fetchExpoPushToken(): Promise<string | null> {
  const projectId =
    Constants?.expoConfig?.extra?.eas?.projectId ??
    (Constants as any)?.easConfig?.projectId;
  if (!projectId) {
    console.warn('[push] EAS projectId 없음 (eas init 필요) — 토큰 발급 생략');
    return null;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const devicePushToken = await Notifications.getDevicePushTokenAsync();
      lastDeviceToken = deviceTokenString(devicePushToken);
      return (await Notifications.getExpoPushTokenAsync({ projectId, devicePushToken })).data;
    } catch (e) {
      if (attempt === 1) console.warn('[push] 토큰 발급 실패', e);
      else await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return null;
}

// 기기 토큰 변경 이벤트(addPushTokenListener) 처리. OS 가 실제로 토큰을 바꿨을 때만 다시 저장한다.
export function handleDevicePushTokenChange(token: Notifications.DevicePushToken): void {
  if (setupsInFlight > 0) return; // 우리가 토큰을 받는 중에 생긴 이벤트
  if (lastDeviceToken !== null && deviceTokenString(token) === lastDeviceToken) return;
  setupPushNotifications();
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

// 채널을 만들고, 알림 권한이 있으면 토큰을 발급해 저장한다. 실패해도 throw 하지 않는다.
// ask=true 면 아직 한 번도 묻지 않은 사람에게 권한 창을 띄운다(온보딩을 이미 마친 사람용).
// 새 사용자는 온보딩 마지막 화면(Screen8Notify)에서 이유를 먼저 보여 주고 묻는다.
// 반환: 토큰을 저장했는지.
// 여러 곳(앱 시작·온보딩·알림 설정)에서 동시에 불려도 한 번에 하나씩 차례로 돈다.
let setupQueue: Promise<unknown> = Promise.resolve();

export function setupPushNotifications(opts: { ask?: boolean } = {}): Promise<boolean> {
  setupsInFlight++;
  const run = setupQueue.then(() => doSetupPushNotifications(opts)).finally(() => { setupsInFlight--; });
  setupQueue = run.catch(() => {});
  return run;
}

async function doSetupPushNotifications({ ask = false }: { ask?: boolean }): Promise<boolean> {
  try {
    if (!Device.isDevice) return false; // 시뮬레이터는 토큰 발급 불가
    await ensureAndroidChannels();
    let perm = await getPushPermission();
    if (!perm.granted && ask && perm.undetermined) perm = await requestPushPermission();
    if (!perm.granted) return false;
    const token = await fetchExpoPushToken();
    if (!token) return false;
    await savePushToken(token);
    return true;
  } catch (e) {
    console.warn('[push] setup 실패', e);
    return false;
  }
}
