"use client";

import { motion } from "framer-motion";
import { Star } from "lucide-react";

const testimonials = [
    {
        name: "Alex Dev",
        handle: "@alexdev",
        role: "Senior Software Engineer",
        content: "RepoMind completely changed how I onboard into legacy codebases. What used to take 2 weeks of blindly reading code now takes me 30 minutes of chatting.",
        avatar: "https://i.pravatar.cc/150?u=alex",
    },
    {
        name: "Sarah Jenkins",
        handle: "@sarah_j",
        role: "Open Source Maintainer",
        content: "The architecture visualizer is black magic. It instantly caught a circular dependency we’ve been trying to hunt down for months in our monorepo.",
        avatar: "https://i.pravatar.cc/150?u=sarah",
    },
    {
        name: "David Kim",
        handle: "@davidk",
        role: "Tech Lead",
        content: "Finally, a tool that understands the entire CONTEXT of my repo instead of just simple RAG document chopping. The massive 1M token context window is an absolute gamechanger for exploring code.",
        avatar: "https://i.pravatar.cc/150?u=david",
    },
    {
        name: "Emily Chen",
        handle: "@emilyc",
        role: "Security Researcher",
        content: "I use RepoMind's deep analysis to instantly scan for vulnerable code patterns across hundreds of repos. It's shockingly accurate.",
        avatar: "https://i.pravatar.cc/150?u=emily",
    },
    {
        name: "Marcus Rodriguez",
        handle: "@marcusr",
        role: "Frontend Architect",
        content: "Tired of tracking down where that one random React context is defined? RepoMind just tells you instantly and shows you exactly how it's wired across your entire application architecture.",
        avatar: "https://i.pravatar.cc/150?u=marcus",
    },
    {
        name: "Jessica Taylor",
        handle: "@jesstact",
        role: "CTO",
        content: "We provide this to all our new hires now. The 'Zero Data Retention' policy made it very easy to get through compliance and strict enterprise security reviews seamlessly.",
        avatar: "https://i.pravatar.cc/150?u=jess",
    },
];

export default function WallOfLove() {
    return (
        <section className="py-24 px-4 relative z-10 max-w-7xl mx-auto w-full">
            <div className="text-center mb-16">
                <h2 className="text-3xl md:text-5xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-b from-white to-zinc-400">
                    Loved by developers
                </h2>
                <p className="text-zinc-400 text-lg">
                    See what engineers are saying about RepoMind.
                </p>
            </div>

            <div className="columns-1 md:columns-2 lg:columns-3 gap-6 space-y-6">
                {testimonials.map((t, idx) => (
                    <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: idx * 0.1 }}
                        className="break-inside-avoid bg-zinc-900/40 border border-zinc-800 p-6 rounded-2xl flex flex-col hover:border-zinc-700 transition-colors"
                    >
                        <div className="flex gap-1 mb-4 text-yellow-500">
                            {[...Array(5)].map((_, i) => (
                                <Star key={i} className="w-4 h-4 fill-current" />
                            ))}
                        </div>
                        <p className="text-zinc-300 text-sm leading-relaxed mb-6">"{t.content}"</p>
                        <div className="flex items-center gap-3 mt-auto">
                            <img
                                src={t.avatar}
                                alt={t.name}
                                width={40}
                                height={40}
                                className="rounded-full shrink-0"
                            />
                            <div>
                                <div className="text-white text-sm font-semibold">{t.name}</div>
                                <div className="text-zinc-500 text-xs">{t.role}</div>
                            </div>
                        </div>
                    </motion.div>
                ))}
            </div>
        </section>
    );
}
