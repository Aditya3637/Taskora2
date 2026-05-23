import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Taskora — Founder's OS",
  description: "Replace 60-minute meetings with 60-second decisions",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Taskora",
  },
};

// Next.js 14 moved themeColor out of `metadata` into its own `viewport`
// export; keeping it on metadata produces a build-time deprecation warning.
export const viewport: Viewport = {
  themeColor: "#E53E3E",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className="bg-white text-midnight antialiased">
        {children}
        <script dangerouslySetInnerHTML={{__html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
              navigator.serviceWorker.register('/sw.js').catch(function(err) {
                console.log('SW registration failed:', err);
              });
            });
          }
        `}} />
      </body>
    </html>
  );
}
