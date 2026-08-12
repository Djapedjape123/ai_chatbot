import type { Metadata } from "next";
import { Merriweather } from "next/font/google";
import "./globals.css";

const merriweather = Merriweather({
  subsets: ["latin"],
  weight: ["300", "400", "700"],
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "Pravni Asistent",
  description: "AI asistent za pravnu literaturu",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sr">
      <body className={`${merriweather.variable} bg-[#F7F3EC] text-[#16263D] antialiased`}>
        {children}
      </body>
    </html>
  );
}