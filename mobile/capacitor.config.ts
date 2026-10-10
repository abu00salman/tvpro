import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.tvpro.mobile',
  appName: 'TV Pro',
  webDir: 'www',
  server: {
    url: 'https://tv-pro.app',
    allowNavigation: ['*.tv-pro.app', 'tv-pro.app'],
    cleartext: false
  },
  android: {
    allowMixedContent: false
  }
};

export default config;
