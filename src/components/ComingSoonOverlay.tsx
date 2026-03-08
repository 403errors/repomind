"use client";

import { Lock } from "lucide-react";
import { motion } from "framer-motion";

export function ComingSoonOverlay() {
    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[8px]" />

            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative bg-zinc-900/90 border border-white/10 p-8 rounded-[2.5rem] shadow-2xl max-w-sm w-full text-center overflow-hidden group"
            >
                {/* Background Glow */}
                <div className="absolute -top-24 -left-24 w-48 h-48 bg-purple-500/20 blur-[80px] rounded-full group-hover:bg-purple-500/30 transition-colors" />
                <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-blue-500/20 blur-[80px] rounded-full group-hover:bg-blue-500/30 transition-colors" />

                <div className="relative z-10">
                    <div className="w-20 h-20 bg-gradient-to-br from-purple-500/20 to-blue-500/20 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-white/5 ring-1 ring-white/10 group-hover:ring-purple-500/30 transition-all duration-500">
                        <Lock className="w-10 h-10 text-purple-400 group-hover:scale-110 transition-transform duration-500" />
                    </div>

                    <h2 className="text-2xl font-bold bg-white bg-clip-text text-transparent mb-2">
                        Settings Locked
                    </h2>
                    <p className="text-zinc-400 text-sm leading-relaxed mb-6">
                        We&apos;re currently fine-tuning your experience. This feature will be available in the next major update.
                    </p>

                    <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-full text-xs font-medium text-zinc-300">
                        <span className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" />
                        Coming Soon
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
