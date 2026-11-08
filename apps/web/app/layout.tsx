import type { Metadata, Viewport } from 'next';
import { Public_Sans, Vollkorn } from 'next/font/google';

import { getBranding } from '@/lib/branding';

import './globals.css';

const publicSans = Public_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const vollkorn = Vollkorn({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['500', '600', '700'],
  display: 'swap',
});

const SITE_URL =
  process.env.PUBLIC_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

const BASE_METADATA: Metadata = {
  metadataBase: new URL(SITE_URL),
  description:
    'Audit web sur 8 axes : SEO, performance, accessibilité, conformité, conversion, UX, UI, contenu.',
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

/**
 * Titles carry the agency name (agency_settings, AGENCY_NAME by default).
 * Icons follow the agency too, on every page (dashboard, login, reports):
 * favicon > logo > default Mynto icon, see lib/favicon.ts.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { name, icons } = await getBranding();
  return {
    ...BASE_METADATA,
    title: { default: name, template: `%s | ${name}` },
    applicationName: name,
    icons: {
      icon: [{ url: icons.faviconUrl, type: icons.faviconType }],
      ...(icons.appleIconUrl !== null
        ? { apple: [{ url: icons.appleIconUrl, sizes: '180x180', type: 'image/png' }] }
        : {}),
    },
  };
}

export const viewport: Viewport = {
  themeColor: '#1a1d2e',
  colorScheme: 'light',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="fr" className={`${publicSans.variable} ${vollkorn.variable}`}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[var(--color-primary)] focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-[var(--color-primary-foreground)]"
        >
          Aller au contenu principal
        </a>
        {children}
      </body>
    </html>
  );
}
