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
import { StyleSheet, Text, View } from 'react-native';
import type { RootStackParamList, TabParamList } from './lib/types';
import { COLORS, FONT, WEIGHT } from './lib/theme';
import { HomeIcon, ClipboardListIcon, UserIcon } from './components/ui/icons';
import { BookmarkIcon } from './components/ui/BookmarkIcon';
import { ensureAnonSession } from './lib/auth';
import { migrateLocalToDB } from './lib/migrate';
import { setupPushNotifications } from './lib/push';
import { fetchNoticeById } from './lib/notices';
import { supabase } from './lib/supabase';
import OnboardingNavigator from './screens/onboarding/OnboardingNavigator';
import ProfileEditScreen from './screens/ProfileEditScreen';
import KeywordManageScreen from './screens/KeywordManageScreen';
import CategoryPrefsScreen from './screens/CategoryPrefsScreen';
import NotificationSettingsScreen from './screens/NotificationSettingsScreen';
import TermsScreen from './screens/TermsScreen';
import PrivacyScreen from './screens/PrivacyScreen';
import DeleteAccountScreen from './screens/DeleteAccountScreen';

import HomeScreen from './screens/HomeScreen';
import InboxScreen from './screens/InboxScreen';
import BookmarkScreen from './screens/BookmarkScreen';
import BookmarkFolderScreen from './screens/BookmarkFolderScreen';
import MyPageScreen from './screens/MyPageScreen';
import NoticeDetailScreen from './screens/NoticeDetailScreen';

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
    return cloneElement(el, { style: [{ fontFamily: 'Pretendard' }, el.props.style] });
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
// keyword: 매칭 공지 1건이면 바로 Detail, 여러 건이면 홈 키워드매치 탭. digest(브리핑) 등은 무시(앱만 열림).
async function routeFromNotificationData(data: any): Promise<void> {
  if (!data || data.type !== 'keyword') return;
  const ids: string[] = Array.isArray(data.noticeIds) ? data.noticeIds : [];
  if (!(await waitUntilNavReady())) return;

  if (ids.length === 1) {
    const notice = await fetchNoticeById(ids[0]);
    if (notice) {
      navigationRef.navigate('Detail', { notice });
      return;
    }
  }
  // 0건(조회 실패 포함) 또는 여러 건 → 홈 키워드매치 탭으로
  (navigationRef.navigate as any)('Tabs', { screen: 'Home', params: { tab: 'keyword' } });
}

type TabIconComponent = (props: { size?: number; color: string }) => React.ReactElement;

function TabIcon({ Icon, focused }: { Icon: TabIconComponent; focused: boolean }) {
  return <Icon size={22} color={focused ? COLORS.accent : COLORS.textTertiary} />;
}

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: COLORS.accent,
        tabBarInactiveTintColor: COLORS.textTertiary,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarLabel: '홈',
          tabBarIcon: ({ focused }) => <TabIcon Icon={HomeIcon} focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Feed"
        component={InboxScreen}
        options={{
          tabBarLabel: '전체 공지',
          tabBarIcon: ({ focused }) => <TabIcon Icon={ClipboardListIcon} focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Bookmark"
        component={BookmarkScreen}
        options={{
          tabBarLabel: '북마크',
          tabBarIcon: ({ focused }) => (
            <BookmarkIcon size={22} color={focused ? COLORS.accent : COLORS.textTertiary} />
          ),
        }}
      />
      <Tab.Screen
        name="MyPage"
        component={MyPageScreen}
        options={{
          tabBarLabel: '마이페이지',
          tabBarIcon: ({ focused }) => <TabIcon Icon={UserIcon} focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [fontsLoaded] = useFonts({ Pretendard: require('./assets/fonts/PretendardVariable.ttf') });
  const [hasProfile, setHasProfile] = useState(false);
  const initStartTime = useRef(Date.now()).current;

  useEffect(() => {
    (async () => {
      // 어떤 init이 실패해도 흰 화면에 갇히지 않도록 finally에서 ready 보장.
      try {
        const session = await ensureAnonSession();
        if (session) {
          await migrateLocalToDB();
          // 푸시 등록은 UI 블록하지 않도록 fire-and-forget.
          setupPushNotifications();
          const { data } = await supabase
            .from('profiles')
            .select('user_id')
            .eq('user_id', session.user.id)
            .maybeSingle();
          setHasProfile(!!data);
        }
      } catch (e) {
        console.error('[App] init failed', e);
      } finally {
        // 스플래시 최소 표시 보장(min). init이 더 빨랐으면 남은 시간만 대기.
        const remaining = MIN_SPLASH_MS - (Date.now() - initStartTime);
        if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
        setReady(true);
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
    Notifications.getLastNotificationResponseAsync().then((resp) => {
      if (resp) routeFromNotificationData(resp.notification.request.content.data);
    });
    return () => sub.remove();
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
            <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
            <Stack.Screen name="Terms" component={TermsScreen} />
            <Stack.Screen name="Privacy" component={PrivacyScreen} />
            <Stack.Screen name="DeleteAccount" component={DeleteAccountScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: COLORS.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    elevation: 0,
  },
  tabLabel: {
    fontSize: FONT.micro,
    fontWeight: WEIGHT.semibold,
  },
});
