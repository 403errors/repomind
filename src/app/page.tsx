"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Github, ArrowRight, Loader2 } from "lucide-react";
import { fetchGitHubData } from "./actions";
import FeatureTiles from "@/components/FeatureTiles";
import { WhatsNewBadge } from "@/components/WhatsNewBadge";
import { GitHubBadge } from "@/components/GitHubBadge";
import { CAGBadge } from "@/components/CAGBadge";
import CAGComparison from "@/components/CAGComparison";
import Footer from "@/components/Footer";
import Image from "next/image";
import { InstallPWA } from "@/components/InstallPWA";
import PublicStats from "@/components/PublicStats";

export default function Home() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    setLoading(true);
    setError("");

    try {
      const result = await fetchGitHubData(input);

      if (result.error) {
        setError(result.error);
      } else {
        // Store data in localStorage or pass via query params/state manager
        // For simplicity, we'll use query params for the ID and fetch again or use a context
        // Let's just navigate to /chat with the query
        router.push(`/chat?q=${encodeURIComponent(input)}`);
      }
    } catch (err) {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex flex-col bg-black text-white overflow-x-hidden relative">
      {/* Fixed Background Layer */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[80vw] max-w-[500px] h-[80vw] max-h-[500px] bg-purple-600/30 rounded-full blur-[80px] md:blur-[128px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[80vw] max-w-[500px] h-[80vw] max-h-[500px] bg-blue-600/30 rounded-full blur-[80px] md:blur-[128px]" />
      </div>

      {/* Hero Section */}
      <section className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden z-10">
        {/* What's New Badge (Top Left) */}
        <WhatsNewBadge />
        {/* GitHub Badge (Top Right) */}
        <GitHubBadge />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="z-10 flex flex-col items-center text-center max-w-2xl w-full px-4"
        >
          <div className="mb-8 conic-border-container rounded-full w-20 h-20 md:w-24 md:h-24 flex items-center justify-center">
            <Image
              src="/1080x1080.png"
              alt="RepoMind Logo"
              width={96}
              height={96}
              className="w-full h-full object-cover rounded-full"
            />
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-b from-white to-white/60">
            RepoMind
          </h1>

          {/* CAG Badge (Below Title) */}
          <CAGBadge />

          <p className="text-base sm:text-lg md:text-xl text-zinc-400 mb-12 max-w-lg mx-auto">
            Deep dive into any repository or profile.
            Analyze code, ask questions, and understand projects in seconds.
          </p>

          <form onSubmit={handleSubmit} className="w-full max-w-md relative group">
            <div className="conic-border-container flex items-center bg-zinc-900 p-1 rounded-lg">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="username or username/repo"
                className="flex-1 bg-transparent border-none outline-none text-white px-3 py-2 md:px-4 md:py-3 placeholder-zinc-500 text-sm md:text-base w-full min-w-0"
              />
              <button
                type="submit"
                disabled={loading}
                className="bg-white text-black p-2 md:p-3 rounded-md hover:bg-zinc-200 transition-colors disabled:opacity-50 shrink-0"
              >
                {loading ? <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" /> : <ArrowRight className="w-4 h-4 md:w-5 md:h-5" />}
              </button>
            </div>
          </form>

          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 text-red-400 text-sm"
            >
              {error}
            </motion.p>
          )}

          <div className="mt-12 md:mt-16 flex flex-wrap justify-center gap-3 md:gap-4 text-xs md:text-sm text-zinc-500">
            <span>Try:</span>
            <button onClick={() => setInput("torvalds")} className="hover:text-white transition-colors">torvalds</button>
            <span className="hidden sm:inline">•</span>
            <button onClick={() => setInput("facebook/react")} className="hover:text-white transition-colors">facebook/react</button>
            <span className="hidden sm:inline">•</span>
            <button onClick={() => setInput("vercel/next.js")} className="hover:text-white transition-colors">vercel/next.js</button>
          </div>

          <PublicStats />
        </motion.div>
      </section>

      {/* CAG Comparison Section */}
      <div className="relative z-10">
        <CAGComparison />
      </div>

      {/* Feature Tiles Section */}
      <section className="relative py-20 z-10">
        <div className="relative z-10">
          <FeatureTiles />
        </div>
      </section>

      <Footer />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            "name": "RepoMind",
            "applicationCategory": "DeveloperApplication",
            "operatingSystem": "Web",
            "offers": {
              "@type": "Offer",
              "price": "0",
              "priceCurrency": "USD",
            },
            "description": "RepoMind is an AI-powered tool that allows developers to visualize and chat with GitHub repositories to understand logic and squash bugs.",
            "aggregateRating": {
              "@type": "AggregateRating",
              "ratingValue": "4.8",
              "ratingCount": "120",
            },
          }),
        }}
      />
      <InstallPWA />
    </main>
  );
}
