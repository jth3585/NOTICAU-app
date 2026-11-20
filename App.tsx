import { useEffect, useRef, useState, cloneElement } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';
import type { RootStackParamList, TabParamList } from './lib/types';
import { COLORS } from './lib/theme';
import { AppTabBar } from './components/ui/AppTabBar';
import { ensureAnonSession } from './lib/auth';
import { migrateLocalToDB } from './lib/migrate';
import { setupPushNotifications } from './lib/push';
import { fetchNoticeById } from './lib/notices';
import { enableEventAlertsByDefault, fetchNotification, markNotificationRead } from './lib/notifications';
import { loadSourceLabels } from './lib/sources';
import { loadOrgNames } from './lib/org';
import { hasKnownProfile, setKnownProfile } from './lib/profile';
import { ToastHost } from './components/ui/ToastHost';
import { OfflineBanner } from './components/ui/OfflineBanner';
import { supabase } from './lib/supabase';
import OnboardingNavigator from './screens/onboarding/OnboardingNavigator';
import ProfileEditScreen from './screens/ProfileEditScreen';
import KeywordManageScreen from './screens/KeywordManageScreen';
import CategoryPrefsScreen from './screens/CategoryPrefsScreen';
import DeptNoticePrefsScreen from './screens/DeptNoticePrefsScreen';
import NotificationSettingsScreen from './screens/NotificationSettingsScreen';
import AccountInfoScreen from './screens/AccountInfoScreen';
import TermsScreen from './screens/TermsScreen';
import PrivacyScreen from './screens/PrivacyScreen';
import DeleteAccountScreen from './screens/DeleteAccountScreen';

import HomeScreen from './screens/HomeScreen';
import InboxScreen from './screens/InboxScreen';
import EventsScreen from './screens/EventsScreen';
import BookmarkScreen from './screens/BookmarkScreen';
import BookmarkFolderScreen from './screens/BookmarkFolderScreen';
import MyPageScreen from './screens/MyPageScreen';
import NoticeDetailScreen from './screens/NoticeDetailScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import NotificationNoticesScreen from './screens/NotificationNoticesScreen';

// 콜드 스타트 시 네이티브 스플래시를 수동 제어 (init 완료 + 최소 표시시간 후 hide).
SplashScreen.preventAutoHideAsync().catch(() => {});
const MIN_SPLASH_MS = 1500; // 콜드 스타트 스플래시 최소 표시 시간

// 전역 기본 글꼴: Pretendard. 컴포넌트가 지정한 style(fontWeight·색 등)은 그대로 우선한다.
// variable 폰트라 기존 fontWeight 값이 그대로 굵기를 선택. Text.render를 한 번만 패치해
// 모든 <Text>에 base fontFamily를 주입(개별 style이 덮어쓰지 않도록 배열 앞에 병합).
const TextAny = Text as any;
if (!TextAny.__fontPatched && typeof TextAny.render === 'function') {
  const origRender = TextAny.render;
  TextAny.render = function (...args: any[]) {
    const el = origRender.apply(this, args);
    // 예외 시 원본 그대로 반환 → 글꼴 패치가 어떤 경우에도 크래시를 내지 않게 보호.
    try {
      return cloneElement(el, {
        style: [{ fontFamily: 'Pretendard' }, el?.props?.style],
        // Dynamic Type 지원하되 과도한 확대로 레이아웃이 깨지지 않게 상한(1.6배).
        maxFontSizeMultiplier: el?.props?.maxFontSizeMultiplier ?? 1.6,
      });
    } catch {
      return el;
    }
  };
  TextAny.__fontPatched = true;
}

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

// 알림 탭 → 화면 이동을 위한 네비게이션 ref (스크린 밖에서 navigate 하기 위함)
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

async function waitUntilNavReady(timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (!navigationRef.isReady()) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
  return true;
}

// 알림 응답(탭) → 적절한 화면으로 라우팅.
// notificationId 있음(알림함 기록된 푸시): 알림 읽음 처리 후 공지 1건이면 바로 Detail,
//   여러 건이면 그 알림에 묶인 공지 모음(NotificationNotices). 키워드·브리핑 공통.
// notificationId 없음(구버전 서버가 보낸 키워드 푸시): 1건이면 Detail, 아니면 홈 키워드매치 탭.
async function routeFromNotificationData(data: any): Promise<void> {
  if (!data || typeof data !== 'object') return;
  const ids: string[] = Array.isArray(data.noticeIds) ? data.noticeIds : [];
  const notificationId: string | null = typeof data.notificationId === 'string' ? data.notificationId : null;
  if (!notificationId && data.type !== 'keyword') return;
  if (!(await waitUntilNavReady())) return;

  if (notificationId) {
    markNotificationRead(notificationId);
    // 브리핑 푸시는 data 크기 한도 때문에 noticeIds를 싣지 않음 → 알림 레코드에서 확인
    const noticeIds = ids.length ? ids : ((await fetchNotification(notificationId))?.notice_ids ?? []);
    if (noticeIds.length === 1) {
      const notice = await fetchNoticeById(noticeIds[0]);
      if (notice) {
        navigationRef.navigate('Detail', { notice, source: `push_${data.type ?? 'unknown'}` });
        return;
      }
    }
    navigationRef.navigate('NotificationNotices', { notificationId });
    return;
  }

  if (ids.length === 1) {
    const notice = await fetchNoticeById(ids[0]);
    if (notice) {
      navigationRef.navigate('Detail', { notice, source: 'push_keyword' });
      return;
    }
  }
  // 0건(조회 실패 포함) 또는 여러 건 → 홈 키워드매치 탭으로
  (navigationRef.navigate as any)('Tabs', { screen: 'Home', params: { tab: 'keyword' } });
}

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <AppTabBar {...props} />}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Feed" component={InboxScreen} />
      <Tab.Screen name="Events" component={EventsScreen} />
      <Tab.Screen name="Bookmark" component={BookmarkScreen} />
      <Tab.Screen name="MyPage" component={MyPageScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [fontsLoaded] = useFonts({ Pretendard: require('./assets/fonts/PretendardVariable.ttf') });
  const [hasProfile, setHasProfile] = useState(false);
  const initStartTime = useRef(Date.now()).current;
  // 스플래시 최소 표시 보장(min). 준비가 더 빨랐으면 남은 시간만 기다렸다가 ready.
  const readyAfterMinSplash = () => {
    const remaining = MIN_SPLASH_MS - (Date.now() - initStartTime);
    if (remaining > 0) setTimeout(() => setReady(true), remaining);
    else setReady(true);
  };

  useEffect(() => {
    (async () => {
      // 온보딩을 마친 기기면(로컬 표시) 세션 갱신·프로필 조회를 기다리지 않고 바로 탭 화면을 띄운다.
      // 아래 초기화는 그 뒤에서 계속 돈다. 처음 쓰는 사람만 네트워크 확인을 기다린다.
      const knownProfile = await hasKnownProfile();
      if (knownProfile) {
        setHasProfile(true);
        readyAfterMinSplash();
      }
      // 어떤 init이 실패해도 흰 화면에 갇히지 않도록 finally에서 ready 보장.
      try {
        const session = await ensureAnonSession();
        if (session) {
          await migrateLocalToDB();
          // 출처 표시 이름 캐시 예열(parser_key→name). 첫 피드 렌더 전에 채워 cau_ 깜빡임 방지.
          loadSourceLabels();
          // 단과대/학과 이름 캐시 예열(마이페이지 표시용).
          loadOrgNames();
          const { data, error } = await supabase
            .from('profiles')
            .select('user_id')
            .eq('user_id', session.user.id)
            .maybeSingle();
          // 조회 실패(오프라인 등)는 판단 근거가 없으니 로컬 표시를 건드리지 않는다.
          if (!error) setKnownProfile(!!data);
          if (!knownProfile) {
            setHasProfile(!!data);
          } else if (!error && !data) {
            // 로컬엔 온보딩 완료로 남았는데 서버엔 프로필이 없다(세션 유실 등) → 온보딩으로 보낸다.
            if (await waitUntilNavReady()) navigationRef.reset({ index: 0, routes: [{ name: 'Onboarding' }] });
          }
          // 푸시 등록은 UI 블록하지 않도록 fire-and-forget. 채널 생성 + 권한이 있으면 토큰 저장.
          // 권한을 묻는 건 온보딩을 마친 사람만(아직 안 물은 경우). 새 사용자는 온보딩 마지막 단계에서 이유와 함께 묻는다.
          setupPushNotifications({ ask: !!data });
          // 행사 알림은 이 버전부터 생긴 기능 → 값이 없는 사람만 한 번 켠다(끈 사람은 그대로).
          if (data) enableEventAlertsByDefault(session.user.id).catch(() => {});
        }
      } catch (e) {
        console.error('[App] init failed', e);
      } finally {
        readyAfterMinSplash();
      }
    })();
  }, []);

  // 초기화 + 폰트 로드가 모두 끝나면 스플래시 해제 (글꼴 깜빡임 방지)
  useEffect(() => {
    if (ready && fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [ready, fontsLoaded]);

  // 알림 탭 라우팅: 앱 실행 중(워밍) 리스너 + 콜드 스타트(앱이 알림으로 열림) 처리
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      routeFromNotificationData(resp.notification.request.content.data);
    });
    // 콜드 스타트: 앱을 띄운 마지막 알림 응답이 있으면 라우팅
    const last = Notifications.getLastNotificationResponse();
    if (last) routeFromNotificationData(last.notification.request.content.data);
    // 기기 푸시 토큰이 바뀌면(드물게 OS 가 교체) Expo 토큰을 다시 받아 저장한다.
    const tokenSub = Notifications.addPushTokenListener(() => { setupPushNotifications(); });
    return () => { sub.remove(); tokenSub.remove(); };
  }, []);

  if (!ready || !fontsLoaded) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: COLORS.bg }} />
      </SafeAreaProvider>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <NavigationContainer ref={navigationRef}>
          <Stack.Navigator
            screenOptions={{ headerShown: false }}
            initialRouteName={hasProfile ? 'Tabs' : 'Onboarding'}
          >
            <Stack.Screen name="Onboarding" component={OnboardingNavigator} />
            <Stack.Screen name="Tabs" component={Tabs} />
            <Stack.Screen name="Detail" component={NoticeDetailScreen} />
            <Stack.Screen name="BookmarkFolder" component={BookmarkFolderScreen} />
            <Stack.Screen name="ProfileEdit" component={ProfileEditScreen} />
            <Stack.Screen name="KeywordManage" component={KeywordManageScreen} />
            <Stack.Screen name="CategoryPrefs" component={CategoryPrefsScreen} />
            <Stack.Screen name="DeptNoticePrefs" component={DeptNoticePrefsScreen} />
            <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
            <Stack.Screen name="AccountInfo" component={AccountInfoScreen} />
            <Stack.Screen name="Terms" component={TermsScreen} />
            <Stack.Screen name="Privacy" component={PrivacyScreen} />
            <Stack.Screen name="DeleteAccount" component={DeleteAccountScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
            <Stack.Screen name="NotificationNotices" component={NotificationNoticesScreen} />
          </Stack.Navigator>
        </NavigationContainer>
        <ToastHost />
        <OfflineBanner />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

