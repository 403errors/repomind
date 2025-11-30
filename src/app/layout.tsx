import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import JsonLd from "./components/json-ld";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://repomind-ai.vercel.app"),
  applicationName: "RepoMind",
  title: {
    default: "Stop reading code. Start talking to it.",
    template: "%s",
  },
  description: "Don't just stare at the repo, interrogate it. Deep dive into logic, squash vulnerabilities and ship faster with AI-powered robust analysis.",
  keywords: [
    "github repo visualizer",
    "codebase analysis",
    "ai code assistant",
    "github repo answering",
    "repository chat",
    "code understanding",
    "developer tools",
    "static analysis",
  ],
  icons: {
    icon: "/favicon.ico",
  },
  appleWebApp: {
    title: "RepoMind",
    statusBarStyle: "default",
  },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "RepoMind: Stop reading code. Start talking to it.",
    description: "Don't just stare at the repo, interrogate it. Deep dive into logic, squash vulnerabilities and ship faster with AI-powered robust analysis.",
    url: "https://repomind-ai.vercel.app",
    siteName: "RepoMind",
    images: [
      {
        url: "/repomind.png",
        width: 1200,
        height: 630,
        alt: "RepoMind AI - GitHub Repository Visualizer and Chat",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "RepoMind: Stop reading code. Start talking to it.",
    description: "Don't just stare at the repo, interrogate it. Deep dive into logic, squash vulnerabilities and ship faster with AI-powered robust analysis.",
    images: ["/repomind.png"],
    creator: "@repomind",
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
        {children}
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
