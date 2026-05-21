import './globals.css';
import { DM_Serif_Display, DM_Sans, DM_Mono } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from '../lib/auth-context';

// next/font/google fetches and self-hosts fonts at BUILD time — no runtime
// network requests are made. The 'preload' option is set to false to avoid
// blocking the build if Google Fonts is slow or unreachable in the build env.
const dmSerif = DM_Serif_Display({
  weight: ['400'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  preload: false,  // prevents build failure if fonts.googleapis.com is slow
  fallback: ['Georgia', 'Times New Roman', 'serif'],
});

const dmSans = DM_Sans({
  weight: ['300', '400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
  preload: false,
  fallback: ['Helvetica Neue', 'Arial', 'sans-serif'],
});

const dmMono = DM_Mono({
  weight: ['400', '500'],
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  preload: false,
  fallback: ['Menlo', 'Courier New', 'monospace'],
});

export const metadata = {
  title: 'EcomShop',
  description: 'Modern e-commerce platform',
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${dmSerif.variable} ${dmSans.variable} ${dmMono.variable}`}
    >
      <body>
        <AuthProvider>
          {children}
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: '#0d0d0d',
                color: '#f5f0e8',
                border: '1px solid #333',
                borderRadius: '4px',
                fontFamily: 'var(--font-body)',
                fontSize: '0.875rem',
              },
              success: { iconTheme: { primary: '#4a7c59', secondary: '#f5f0e8' } },
              error:   { iconTheme: { primary: '#c94a2b', secondary: '#f5f0e8' } },
            }}
          />
        </AuthProvider>
      </body>
    </html>
  );
}
