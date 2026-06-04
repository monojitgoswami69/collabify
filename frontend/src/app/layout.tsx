import type { Metadata, Viewport } from 'next';
import {
  JetBrains_Mono,
  Quantico,
  Kode_Mono,
  Nova_Mono,
  Syne_Mono,
  Space_Mono,
} from 'next/font/google';
import './globals.css';

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700', '800'],
  variable: '--font-jetbrains',
  display: 'swap',
});

const quantico = Quantico({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-quantico',
  display: 'swap',
});

const kodeMono = Kode_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-kode',
  display: 'swap',
});

const novaMono = Nova_Mono({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-nova',
  display: 'swap',
});

const syneMono = Syne_Mono({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-syne',
  display: 'swap',
});

const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  variable: '--font-space',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Collabify',
  description:
    'Collabify — Monaco-powered collaborative code editor with conflict-free real-time editing.',
  manifest: '/favicons/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicons/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicons/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicons/favicon.ico' },
    ],
    apple: [{ url: '/favicons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1e1e2e',
};

const themeBootstrap = `
(function() {
  try {
    var stored = localStorage.getItem('codecollab-v2-theme');
    var theme = (stored === 'light' || stored === 'dark')
      ? stored
      : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    var root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
  } catch (_) {
    document.documentElement.classList.add('dark');
  }
})();
`;

const fontVariables = [
  jetbrainsMono.variable,
  quantico.variable,
  kodeMono.variable,
  novaMono.variable,
  syneMono.variable,
  spaceMono.variable,
].join(' ');

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
