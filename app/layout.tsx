import type { Metadata } from "next";
import { Analytics } from "@/components/analytics";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "Restroom Ready — Know before you go.", template: "%s · Restroom Ready" },
  description: "Entry rules, the route inside, and visitor-reported restroom conditions. Help shape a more useful way to find a restroom in NYC.",
  icons: { icon: "/favicon.png", apple: "/apple-touch-icon.png" },
  robots: { index: true, follow: true },
};
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><head><link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/><link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/></head><body>{children}<Analytics/></body></html>;
}
