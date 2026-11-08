import { redirect } from 'next/navigation';

/** The install has no public home: the dashboard (login first) is the entry point. */
export default function HomePage(): never {
  redirect('/dashboard');
}
