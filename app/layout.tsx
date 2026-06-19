import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { InstallBanner } from "@/components/InstallBanner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Unveil",
  description: "Pay-per-tap premium content with MPP-backed reveals.",
  applicationName: "Unveil",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Unveil",
  },
  formatDetection: { telephone: false },
  manifest: "/manifest.webmanifest",
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // handles iPhone notch
  themeColor: "#000000",
};

// Applies the persisted theme before paint (dark default → no class). No FOUC.
const themeScript = `(function(){try{if(localStorage.getItem('veil-theme')==='light'){document.documentElement.classList.add('light')}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="bg-bg text-text flex min-h-full flex-col">
        <ClerkProvider>
          <Script
            id="veil-theme"
            strategy="beforeInteractive"
            dangerouslySetInnerHTML={{ __html: themeScript }}
          />
          <Providers>
            {children}
            <InstallBanner />
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
