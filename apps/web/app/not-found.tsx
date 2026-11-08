import type { Metadata } from 'next';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Page introuvable',
  robots: { index: false, follow: false },
};

export default function NotFound(): React.ReactElement {
  return (
    <main id="main">
      <section className="mx-auto flex max-w-[1180px] flex-col items-center px-6 py-24 text-center md:py-32">
        <p className="font-serif text-[7rem] font-medium leading-none tracking-tight text-[var(--color-primary)] md:text-[10rem]">
          404
        </p>
        <h1 className="mt-4 font-serif text-3xl font-medium tracking-tight md:text-4xl">
          Cette page n&apos;existe pas
        </h1>
        <p className="mt-3 max-w-lg text-base text-[var(--color-muted-foreground)]">
          Le lien est peut-être incorrect, ou l&apos;audit a expiré.
        </p>
        <div className="mt-8">
          <Button asChild size="lg">
            <Link href="/">Retour à l&apos;accueil</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
