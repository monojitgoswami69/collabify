import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Quantico, Kode_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

const quantico = Quantico({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-quantico',
  display: 'swap',
});

const kodeMono = Kode_Mono({
  subsets: ['latin'],
  variable: '--font-kode',
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className={`${inter.variable} ${jetbrainsMono.variable} ${quantico.variable} ${kodeMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
