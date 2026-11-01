import { IBM_Plex_Sans, Newsreader } from 'next/font/google';

// Fontovi samo za početnu stranicu. Učitavaju se ovde, a ne u layout.tsx, da ostale stranice ne preuzimaju
// dodatne fajlove. "latin-ext" nosi č, ć, š, ž i đ.
export const display = Newsreader({
  subsets: ['latin', 'latin-ext'],
  style: ['normal', 'italic'],
  axes: ['opsz'],
  variable: '--font-newsreader',
  display: 'swap',
});

export const body = IBM_Plex_Sans({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-plex-sans',
  display: 'swap',
});
