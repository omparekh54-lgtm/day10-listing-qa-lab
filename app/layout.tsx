import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Listing QA Lab',
  description: 'Browser-local ecommerce image quality control and listing readiness analysis.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
