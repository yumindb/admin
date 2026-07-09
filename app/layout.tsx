import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "裕民工務 管理系統",
  description: "裕民工務 管理系統",
  // 手機「加到主畫面」的圖示:iOS 走 apple-touch-icon,Android/PWA 走 manifest
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/yumin-badge.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  // iOS 加到主畫面後的名稱(短,避免被截斷)+ 全螢幕 web app
  appleWebApp: {
    capable: true,
    title: "裕民工務",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#003153",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-Hant"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
        <Toaster
          position="top-center"
          richColors
          closeButton
          toastOptions={{
            classNames: {
              toast: "border border-[#E0DCD6] rounded-md font-sans",
            },
          }}
        />
      </body>
    </html>
  );
}
