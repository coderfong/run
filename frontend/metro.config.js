const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const WEB_MOCKS = {
  'react-native-maps': 'src/mocks/react-native-maps.web.js',
  'expo-secure-store': 'src/mocks/expo-secure-store.web.js',
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_MOCKS[moduleName]) {
    return {
      filePath: path.resolve(__dirname, WEB_MOCKS[moduleName]),
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
