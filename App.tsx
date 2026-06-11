import { useEffect, useRef, useState } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import type { RootStackParamList, TabParamList } from './lib/types';
import { COLORS, FONT, WEIGHT } from './lib/theme';
import { ensureAnonSession } from './lib/auth';
import { migrateLocalToDB } from './lib/migrate';
import { setupPushNotifications } from './lib/push';
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
import MyPageScreen from './screens/MyPageScreen';
import NoticeDetailScreen from './screens/NoticeDetailScreen';

// 콜드 스타트 시 네이티브 스플래시를 수동 제어 (init 완료 + 최소 표시시간 후 hide).
SplashScreen.preventAutoHideAsync().catch(() => {});
const MIN_SPLASH_MS = 1500; // 콜드 스타트 스플래시 최소 표시 시간

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>
  );
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
          tabBarIcon: ({ focused }) => <TabIcon emoji="🏠" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Feed"
        component={InboxScreen}
        options={{
          tabBarLabel: '전체 공지',
          tabBarIcon: ({ focused }) => <TabIcon emoji="📋" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Bookmark"
        component={BookmarkScreen}
        options={{
          tabBarLabel: '북마크',
          tabBarIcon: ({ focused }) => <TabIcon emoji="🔖" focused={focused} />,
        }}
      />
      <Tab.Screen
        name="MyPage"
        component={MyPageScreen}
        options={{
          tabBarLabel: '마이페이지',
          tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
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
        await SplashScreen.hideAsync();
      }
    })();
  }, []);

  if (!ready) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: COLORS.bg }} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <NavigationContainer>
        <Stack.Navigator
          screenOptions={{ headerShown: false }}
          initialRouteName={hasProfile ? 'Tabs' : 'Onboarding'}
        >
          <Stack.Screen name="Onboarding" component={OnboardingNavigator} />
          <Stack.Screen name="Tabs" component={Tabs} />
          <Stack.Screen name="Detail" component={NoticeDetailScreen} />
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
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: COLORS.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    elevation: 0,
  },
  tabLabel: {
    fontSize: FONT.micro,
    fontWeight: WEIGHT.semibold,
  },
});
