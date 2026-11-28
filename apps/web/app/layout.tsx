import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Filler — Voice inference, in flow',
  description: 'A scheduler for voice inference requests. Prioritize work, keep workers healthy, and make every queue visible.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
