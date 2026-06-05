import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { OnboardingProvider } from '../../contexts/OnboardingContext';
import type { OnboardingStackParamList } from '../../lib/types';
import Screen1Grade from './Screen1Grade';
import Screen2Campus from './Screen2Campus';
import Screen3CollegeDept from './Screen3CollegeDept';
import Screen4SecondaryDept from './Screen4SecondaryDept';
import Screen5Enrollment from './Screen5Enrollment';
import Screen6Career from './Screen6Career';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export default function OnboardingNavigator() {
  return (
    <OnboardingProvider>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="Grade" component={Screen1Grade} />
        <Stack.Screen name="Campus" component={Screen2Campus} />
        <Stack.Screen name="CollegeDept" component={Screen3CollegeDept} />
        <Stack.Screen name="SecondaryDept" component={Screen4SecondaryDept} />
        <Stack.Screen name="Enrollment" component={Screen5Enrollment} />
        <Stack.Screen name="Career" component={Screen6Career} />
      </Stack.Navigator>
    </OnboardingProvider>
  );
}
