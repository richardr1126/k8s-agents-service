import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PrivacyPopup } from "@/components/privacy-popup";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "chat.richardr.dev",
  description: "AI Chat Assistant by Richard Roberson",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const themeInitCode = `(function(){try{var k='theme';var c=document.documentElement.classList;var m=window.matchMedia('(prefers-color-scheme: dark)');var s=localStorage.getItem(k);function a(t){t==='dark'?c.add('dark'):c.remove('dark')}var t=s||(m.matches?'dark':'light');a(t);if(!s){m.addEventListener('change',function(e){a(e.matches?'dark':'light')})}window.__setTheme=function(t){if(!t){localStorage.removeItem(k);a(m.matches?'dark':'light');return;}localStorage.setItem(k,t);a(t);};}catch(e){}})();`;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Inline, blocking script to set initial color mode before paint */}
        <script id="theme-init" dangerouslySetInnerHTML={{ __html: themeInitCode }} />
        {/* PWA manifest */}
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="theme-color" content="#000000" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Chat AI" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
        <PrivacyPopup />
      </body>
    </html>
  );
}
