import type { Metadata, Viewport } from 'next';
import './globals.css';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const metadata: Metadata = {
  title: 'TV Pro — Watch Simply.',
  description: 'One player. Every screen. Live TV, movies and series through your own streaming sources.',
  applicationName: 'TV Pro',
  manifest: `${BASE}/manifest.webmanifest`,
  appleWebApp: { capable: true, title: 'TV Pro', statusBarStyle: 'black-translucent' },
  icons: { icon: [{ url: `${BASE}/icons/icon.svg`, type: 'image/svg+xml' }], apple: `${BASE}/icons/apple-touch-icon.png` },
  referrer: 'no-referrer',
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#080A0D',
};

/** Runs before first paint so the wrong theme/direction never flashes. Keep tiny and dependency free. */
const NO_FLASH = `(function(){try{var s=JSON.parse(localStorage.getItem('tvpro:settings')||'{}');var t=s.theme||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.dataset.theme=d?'dark':'light';if(s.language==='ar'){r.lang='ar';r.dir='rtl'}}catch(e){document.documentElement.dataset.theme='dark'}})();`;

/**
 * Streams come from user-chosen hosts, so media/connect/img stay open; scripts, frames,
 * forms and plugins are locked to this origin. Send the same policy as an HTTP header in production.
 */
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https: http:",
  "media-src 'self' blob: https: http:",
  "connect-src 'self' https: http: ws: wss:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" data-theme="dark" suppressHydrationWarning>
      <head>
        <meta httpEquiv="Content-Security-Policy" content={CSP} />
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
