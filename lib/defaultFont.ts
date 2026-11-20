import { createElement } from 'react';

// 전역 기본 글꼴: Pretendard + 큰 글씨 상한(1.6배). 앱 코드뿐 아니라 라이브러리(마크다운 본문 등)의
// <Text> 에도 똑같이 적용되도록, react-native 가 내보내는 Text 자체를 감싼 컴포넌트로 바꿔 끼운다.
//
// 예전엔 Text.render 를 패치했는데, RN 0.88(SDK 58)부터 Text 가 forwardRef 가 아닌 일반 함수 컴포넌트라
// render 가 없어 패치가 조용히 건너뛰어졌다(앱 전체가 시스템 글꼴로 보이던 원인).
// Text 모듈의 default 는 번들에서 읽기 전용 getter 라 바꿀 수 없다. 대신 react-native 진입점(index.js)의
// `Text` getter(객체 리터럴이라 다시 정의 가능)를 감싼 컴포넌트를 돌려주도록 바꾼다. `import { Text } from
// 'react-native'` 는 번들에서 렌더할 때마다 `_reactNative.Text` 를 읽으므로 이후 모든 렌더에 적용된다.
// index.ts 에서 App 보다 먼저 불러온다(모듈 로드 시점에 Text 를 붙잡는 라이브러리도 감싼 쪽을 쓰게).
//
// 컴포넌트가 지정한 style(fontWeight·fontFamily 등)이 우선하도록 기본값을 배열 맨 앞에 둔다.
// variable 폰트라 fontWeight 값이 그대로 굵기를 고른다.
const BASE_STYLE = { fontFamily: 'Pretendard' } as const;
const MAX_FONT_SCALE = 1.6;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native');
  const desc = Object.getOwnPropertyDescriptor(RN, 'Text');
  const Original = RN.Text;
  if (desc?.configurable && typeof Original === 'function' && !Original.__appDefaultFont) {
    // React 19: ref 도 일반 prop 이라 {...props} 로 그대로 넘어간다.
    const AppText = (props: any) => createElement(Original, {
      ...props,
      style: [BASE_STYLE, props.style],
      maxFontSizeMultiplier: props.maxFontSizeMultiplier ?? MAX_FONT_SCALE,
    });
    AppText.displayName = 'Text';
    AppText.__appDefaultFont = true;
    Object.defineProperty(RN, 'Text', { configurable: true, enumerable: true, get: () => AppText });
  } else if (__DEV__ && !Original?.__appDefaultFont) {
    console.warn('[font] 기본 글꼴 적용 실패 — react-native Text 를 바꿔 끼우지 못했습니다.');
  }
} catch (e) {
  // 어떤 경우에도 글꼴 때문에 앱이 죽지 않게 한다(시스템 글꼴로 동작).
  if (__DEV__) console.warn('[font] 기본 글꼴 적용 실패', e);
}
