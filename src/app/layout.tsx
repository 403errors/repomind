import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import JsonLd from "./components/json-ld";
import { Providers } from "@/components/Providers";
import { getCanonicalSiteUrl } from "@/lib/site-url";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

const canonicalSiteUrl = getCanonicalSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(canonicalSiteUrl),
  applicationName: "RepoMind",
  title: {
    default: "RepoMind",
    template: "%s | RepoMind",
  },
  description: "Analyze GitHub repositories with full-context AI for architecture understanding, code review, and security scanning.",
  keywords: [
    "github repository analysis",
    "github code analyzer",
    "ai code review tool",
    "repository security scanner",
    "repository risk analysis",
    "architecture analysis",
    "code intelligence",
    "developer tools",
  ],
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/no-bg-repomind.png', sizes: '500x500', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: "RepoMind",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "RepoMind",
    description: "Analyze GitHub repositories with full-context AI for architecture understanding, code review, and security scanning.",
    url: canonicalSiteUrl,
    siteName: "RepoMind",
    images: [
      {
        url: "/assets/landing_page.png",
        width: 1200,
        height: 630,
        alt: "RepoMind landing page preview",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "RepoMind",
    description: "Analyze GitHub repositories with full-context AI for architecture understanding, code review, and security scanning.",
    images: ["/assets/landing_page.png"],
    creator: "@repomind",
    site: "@repomind",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  verification: {
    google: "UkRCYeGXDptF64Z3y2sS0d2AUkCSuirzjRZQJUz1iEQ",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${montserrat.variable}`} suppressHydrationWarning>
      <body
        className="antialiased font-sans"
        suppressHydrationWarning
      >
        <JsonLd />
        <Providers>
          {children}
        </Providers>
        <Toaster
          position="top-right"
          theme="dark"
          richColors
          closeButton
          toastOptions={{
            style: {
              background: '#18181b',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#fff',
            },
          }}
        />
      </body>
    </html>
  );
}
