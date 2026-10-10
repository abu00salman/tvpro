import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.tvpro.mobile',
  appName: 'TV Pro',
  webDir: 'www',
  backgroundColor: '#080A0D',
  server: {
    url: 'https://tv-pro.app',
    allowNavigation: ['*.tv-pro.app', 'tv-pro.app'],
    cleartext: false
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#080A0D'
  },
  ios: {
    backgroundColor: '#080A0D',
    // The web app already lays itself out with env(safe-area-inset-*) CSS.
    // Leaving this as the default 'automatic' makes WKWebView add its own
    // content inset on top of that, so the page ends up taller than the
    // screen (worse on devices with a bigger inset, e.g. iPhone 17 Pro Max)
    // and the extra height shows up as web-page-like overflow/scrolling.
    contentInset: 'never',
    // The page manages its own internal scrolling; letting the top-level
    // WKWebView scroll too is what produces the rubber-band/bounce feel.
    scrollEnabled: false,
    allowsLinkPreview: false
  }
};

export default config;
