import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.planless.app',
  appName: 'PlanLess',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    StatusBar: {
      style: 'Dark',
      backgroundColor: '#0f0f0f',
      overlaysWebView: false,
    },
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#0f0f0f',
      showSpinner: false,
      launchAutoHide: true,
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
