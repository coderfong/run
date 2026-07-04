// babel-preset-expo auto-configures the react-native-worklets plugin
// (required by Reanimated 4) when the package is installed.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
