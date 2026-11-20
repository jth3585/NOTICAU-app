// 기본 글꼴(Pretendard)을 react-native Text 에 입힌다 — 다른 모듈(제스처·애니메이션 라이브러리 포함)이
// 모듈 로드 시점에 Text 를 붙잡기 전에 가장 먼저.
import './lib/defaultFont';
import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
