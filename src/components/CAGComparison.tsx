"use client";

import React from "react";
import { motion } from "framer-motion";
import { Check, X, Brain, Database } from "lucide-react";

export default function CAGComparison() {
    return (
        <section id="cag-comparison" className="py-24 px-4 relative overflow-hidden">
            <div className="max-w-6xl mx-auto relative z-10">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.6 }}
                    className="text-center mb-16"
                >
                    <h2 className="text-3xl md:text-5xl font-bold mb-6 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
                        CAG vs. Traditional RAG
                    </h2>
                    <p className="text-zinc-400 text-lg max-w-2xl mx-auto">
                        RepoMind uses <strong>Context Augmented Generation (CAG)</strong>. We don't just retrieve fragments; we understand the whole picture.
                    </p>
                </motion.div>

                <div className="grid md:grid-cols-2 gap-8">
                    {/* Traditional RAG Card */}
                    <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-8 backdrop-blur-sm cursor-default flex flex-col hover:border-zinc-700 transition-colors">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-3 bg-zinc-800 rounded-lg">
                                <Database className="w-6 h-6 text-zinc-400" />
                            </div>
                            <h3 className="text-2xl font-semibold text-zinc-300">Traditional RAG</h3>
                        </div>

                        {/* RAG Animation Canvas */}
                        <div className="w-full h-48 bg-zinc-950 rounded-xl mb-8 relative overflow-hidden flex items-center justify-center border border-zinc-800 shadow-inner">
                            <motion.div
                                className="absolute w-32 h-32 bg-zinc-800 rounded-md flex flex-col gap-1 p-2 opacity-50"
                                initial={{ scale: 1, opacity: 1 }}
                                animate={{ scale: [1, 1.1, 0], opacity: [1, 0.5, 0] }}
                                transition={{ duration: 3, repeat: Infinity }}
                            >
                                <div className="h-4 bg-zinc-700 rounded w-3/4 mb-2"></div>
                                <div className="h-2 bg-zinc-700 rounded w-full"></div>
                                <div className="h-2 bg-zinc-700 rounded w-5/6"></div>
                                <div className="h-2 bg-zinc-700 rounded w-full"></div>
                            </motion.div>

                            {/* Chopped chunks flying away */}
                            {[...Array(6)].map((_, i) => (
                                <motion.div
                                    key={i}
                                    className="absolute w-12 h-12 bg-red-900/30 border border-red-500/50 rounded flex items-center justify-center text-[10px] text-red-500 font-mono"
                                    initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
                                    animate={{
                                        x: (Math.random() - 0.5) * 200,
                                        y: (Math.random() - 0.5) * 200,
                                        opacity: [0, 1, 0],
                                        scale: [0.5, 1, 0.5],
                                        rotate: (Math.random() - 0.5) * 90
                                    }}
                                    transition={{ duration: 3, repeat: Infinity, delay: 1 + i * 0.2 }}
                                >
                                    chunk_{i}
                                </motion.div>
                            ))}

                            <motion.div
                                className="absolute bottom-4 right-4 text-xs font-mono text-zinc-500 bg-black/50 px-2 py-1 rounded"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: [0, 1, 1, 0] }}
                                transition={{ duration: 3, repeat: Infinity }}
                            >
                                Context lost...
                            </motion.div>
                        </div>

                        <div className="space-y-4 flex-1">
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 p-1 bg-red-500/10 rounded-full shrink-0">
                                    <X className="w-4 h-4 text-red-500" />
                                </div>
                                <div>
                                    <h4 className="font-medium text-zinc-200 text-sm">Fragmented Context</h4>
                                    <p className="text-xs text-zinc-500 mt-1">Chops code into disconnected vector chunks, losing the big picture.</p>
                                </div>
                            </div>

                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 p-1 bg-red-500/10 rounded-full shrink-0">
                                    <X className="w-4 h-4 text-red-500" />
                                </div>
                                <div>
                                    <h4 className="font-medium text-zinc-200 text-sm">Similarity Search Flaws</h4>
                                    <p className="text-xs text-zinc-500 mt-1">Relies on fuzzy matching which often misses logic buried in imports.</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* RepoMind CAG Card */}
                    <div className="bg-gradient-to-b from-blue-900/20 to-purple-900/20 border border-blue-500/30 rounded-2xl p-8 backdrop-blur-sm relative overflow-hidden hover:border-blue-500/50 transition-colors cursor-default flex flex-col shadow-[0_0_30px_rgba(59,130,246,0.1)]">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 blur-[50px] rounded-full" />

                        <div className="flex items-center gap-3 mb-6 relative z-10">
                            <div className="p-3 bg-blue-500/20 rounded-lg">
                                <Brain className="w-6 h-6 text-blue-400" />
                            </div>
                            <h3 className="text-2xl font-semibold text-white">RepoMind (CAG)</h3>
                        </div>

                        {/* CAG Animation Canvas */}
                        <div className="w-full h-48 bg-black/40 rounded-xl mb-8 relative overflow-hidden flex items-center justify-center border border-blue-500/20 shadow-inner z-10">
                            {/* Glowing central node */}
                            <motion.div
                                className="absolute w-16 h-16 bg-blue-500/20 border-2 border-blue-400 rounded-full shadow-[0_0_30px_rgba(59,130,246,0.5)] flex items-center justify-center text-blue-300 font-mono text-xs font-bold"
                                animate={{ scale: [1, 1.05, 1], boxShadow: ["0 0 20px rgba(59,130,246,0.3)", "0 0 40px rgba(59,130,246,0.6)", "0 0 20px rgba(59,130,246,0.3)"] }}
                                transition={{ duration: 2, repeat: Infinity }}
                            >
                                LM
                            </motion.div>

                            {/* Connected File Nodes */}
                            {[...Array(5)].map((_, i) => {
                                const angle = (i * (360 / 5)) * (Math.PI / 180);
                                const radius = 60;
                                const x = Math.cos(angle) * radius;
                                const y = Math.sin(angle) * radius;
                                return (
                                    <React.Fragment key={`node-group-${i}`}>
                                        {/* Connection Lines */}
                                        <motion.svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
                                            <motion.line
                                                x1="50%" y1="50%"
                                                x2={`calc(50% + ${x}px)`} y2={`calc(50% + ${y}px)`}
                                                stroke="#3b82f6" strokeWidth="2" strokeOpacity="0.4"
                                                initial={{ pathLength: 0 }}
                                                animate={{ pathLength: [0, 1, 1] }}
                                                transition={{ duration: 3, repeat: Infinity, delay: i * 0.2 }}
                                            />
                                        </motion.svg>

                                        {/* Nodes */}
                                        <motion.div
                                            key={`node-${i}`}
                                            className="absolute w-8 h-8 bg-purple-900/40 border border-purple-500/50 rounded flex items-center justify-center text-[8px] text-purple-300 font-mono"
                                            style={{ left: `calc(50% + ${x - 16}px)`, top: `calc(50% + ${y - 16}px)` }}
                                            initial={{ opacity: 0, scale: 0 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            transition={{ duration: 0.5, delay: i * 0.2 }}
                                        >
                                            .ts
                                        </motion.div>
                                    </React.Fragment>
                                );
                            })}

                            <motion.div
                                className="absolute bottom-4 left-4 text-xs font-mono text-blue-400 bg-blue-900/30 px-2 py-1 rounded border border-blue-500/20"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: [0, 1, 1] }}
                                transition={{ duration: 3, repeat: Infinity }}
                            >
                                1M+ Token Context Active
                            </motion.div>
                        </div>

                        <div className="space-y-4 flex-1 relative z-10">
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 p-1 bg-green-500/10 rounded-full shrink-0">
                                    <Check className="w-4 h-4 text-green-400" />
                                </div>
                                <div>
                                    <h4 className="font-medium text-white text-sm">Full File Context</h4>
                                    <p className="text-xs text-zinc-400 mt-1">Loads entire relevant files into the 1M+ token window for flawless logic tracing.</p>
                                </div>
                            </div>

                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 p-1 bg-green-500/10 rounded-full shrink-0">
                                    <Check className="w-4 h-4 text-green-400" />
                                </div>
                                <div>
                                    <h4 className="font-medium text-white text-sm">Smart Agent Selection</h4>
                                    <p className="text-xs text-zinc-400 mt-1">AI intelligently pulls exact full-file dependencies needed.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
