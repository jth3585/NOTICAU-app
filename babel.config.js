module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-worklets/plugin은 reanimated v4의 babel 플러그인.
    // 반드시 plugins 배열 맨 마지막에 위치해야 함 (순서 틀리면 조용히 작동 안 함).
    plugins: ['react-native-worklets/plugin'],
  };
};
