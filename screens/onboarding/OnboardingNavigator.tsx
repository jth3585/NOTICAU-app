import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { OnboardingProvider } from '../../contexts/OnboardingContext';
import type { OnboardingStackParamList } from '../../lib/types';
import Screen1Grade from './Screen1Grade';
import Screen2Campus from './Screen2Campus';
import Screen3College from './Screen3College';
import Screen4Dept from './Screen4Dept';
import Screen5SecondaryDept from './Screen5SecondaryDept';
import Screen6Enrollment from './Screen6Enrollment';
import Screen7Nickname from './Screen7Nickname';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export default function OnboardingNavigator() {
  return (
    <OnboardingProvider>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="Grade" component={Screen1Grade} />
        <Stack.Screen name="Campus" component={Screen2Campus} />
        <Stack.Screen name="College" component={Screen3College} />
        <Stack.Screen name="Dept" component={Screen4Dept} />
        <Stack.Screen name="SecondaryDept" component={Screen5SecondaryDept} />
        <Stack.Screen name="Enrollment" component={Screen6Enrollment} />
        <Stack.Screen name="Nickname" component={Screen7Nickname} />
      </Stack.Navigator>
    </OnboardingProvider>
  );
}
