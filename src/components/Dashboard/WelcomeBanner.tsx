"use client";

import { motion } from "framer-motion";
import { User, Github, Calendar } from "lucide-react";
import Image from "next/image";

interface WelcomeBannerUser {
    image?: string | null;
    name?: string | null;
}

export default function WelcomeBanner({ user }: { user: WelcomeBannerUser }) {
    const date = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden p-8 rounded-3xl bg-zinc-900 border border-white/5 group"
        >
            <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                <Github className="w-32 h-32" />
            </div>

            <div className="relative z-10 flex flex-col md:flex-row items-center gap-6">
                <div className="w-24 h-24 rounded-2xl overflow-hidden border-2 border-purple-500/50 p-1 bg-zinc-950">
                    {user.image ? (
                        <Image
                            src={user.image}
                            alt={user.name || "User"}
                            width={96}
                            height={96}
                            className="rounded-xl object-cover"
                        />
                    ) : (
                        <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                            <User className="w-8 h-8 text-zinc-400" />
                        </div>
                    )}
                </div>

                <div className="text-center md:text-left">
                    <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white via-white to-white/60 mb-2">
                        Welcome back, {user.name?.split(' ')[0]}!
                    </h1>
                    <div className="flex flex-wrap justify-center md:justify-start gap-4 text-zinc-400 text-sm">
                        <div className="flex items-center gap-1.5">
                            <Calendar className="w-4 h-4 text-purple-400" />
                            <span>{date}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Github className="w-4 h-4 text-blue-400" />
                            <span>Connected via GitHub</span>
                        </div>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}
