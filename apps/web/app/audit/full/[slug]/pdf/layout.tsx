import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Print view of the report: the template engine owns @page and print CSS. */
export default function PdfLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return <>{children}</>;
}
