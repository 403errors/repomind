"use client";

import { motion } from "framer-motion";
import { MessageSquare, GitBranch, Search, Shield, Users, Activity, Layers, Code2 } from "lucide-react";

export default function BentoFeatures() {
    return (
        <section className="w-full max-w-7xl mx-auto px-4 py-24 relative z-10">
            <div className="text-center mb-16">
                <h2 className="text-4xl md:text-5xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-b from-white to-white/60">
                    Everything you need to understand code
                </h2>
                <p className="text-zinc-400 text-lg md:text-xl max-w-2xl mx-auto mb-12">
                    RepoMind gives you superpowers to digest entire repositories in seconds.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6 auto-rows-[minmax(200px,auto)]">

                {/* 1. Deep Code Analysis - Large */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="col-span-1 md:col-span-2 lg:col-span-2 row-span-2 rounded-3xl bg-zinc-900/40 border border-zinc-800 p-8 flex flex-col justify-between relative overflow-hidden group hover:border-zinc-700 transition-colors"
                >
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                    <div className="relative z-10">
                        <div className="w-12 h-12 rounded-2xl bg-blue-500/20 flex items-center justify-center mb-6">
                            <Code2 className="w-6 h-6 text-blue-400" />
                        </div>
                        <h3 className="text-2xl font-bold text-white mb-3">Deep Code Analysis</h3>
                        <p className="text-zinc-400 text-sm leading-relaxed max-w-sm">
                            Our AI ingests millions of tokens to give you expert-level understanding of any repository structure, completely eliminating the clone-and-browse phase.
                        </p>
                    </div>

                    {/* Decorative Background */}
                    <div className="absolute bottom-0 right-0 w-2/3 h-1/2 bg-gradient-to-t from-blue-900/20 to-transparent border-t border-l border-blue-500/20 rounded-tl-2xl shadow-[-20px_-20px_30px_rgba(59,130,246,0.05)] text-[10px] text-blue-300/30 font-mono p-4 overflow-hidden pointer-events-none">
                        {'// Abstract Syntax Tree parsed'}<br />
                        {'const repo = await RepoMind.analyze();'}<br />
                        {'repo.modules.forEach(m => {'}<br />
                        &nbsp;&nbsp;{'console.log(m.dependencies);'}<br />
                        {'});'}
                    </div>
                </motion.div>

                {/* 2. Ask Your Repo - Medium */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.1 }}
                    className="col-span-1 md:col-span-1 lg:col-span-2 row-span-1 rounded-3xl bg-zinc-900/40 border border-zinc-800 p-8 relative overflow-hidden group hover:border-zinc-700 transition-colors"
                >
                    <div className="absolute inset-0 bg-gradient-to-br from-purple-600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                    <div className="relative z-10 flex flex-col sm:flex-row gap-6 items-center">
                        <div className="flex-1">
                            <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center mb-4">
                                <MessageSquare className="w-5 h-5 text-purple-400" />
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">Ask Your Repo</h3>
                            <p className="text-zinc-400 text-sm leading-relaxed">
                                Chat naturally to find bugs, logic, or missing pieces.
                            </p>
                        </div>
                        <div className="w-full sm:w-48 bg-black/50 border border-zinc-800 rounded-xl p-3 shadow-inner">
                            <div className="text-xs text-zinc-500 font-mono mb-2">Prompt:</div>
                            <div className="text-sm text-zinc-300">Where is the DB schema?</div>
                        </div>
                    </div>
                </motion.div>

                {/* 3. Architecture Visualizer - Small */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.2 }}
                    className="col-span-1 md:col-span-1 lg:col-span-1 row-span-1 rounded-3xl bg-zinc-900/40 border border-zinc-800 p-6 flex flex-col relative overflow-hidden group hover:border-zinc-700 transition-colors"
                >
                    <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center mb-4 relative z-10">
                        <GitBranch className="w-5 h-5 text-cyan-400" />
                    </div>
                    <div className="relative z-10">
                        <h3 className="text-lg font-bold text-white mb-2">Architecture</h3>
                        <p className="text-zinc-400 text-xs leading-relaxed">
                            Generate interactive flowcharts and dependency graphs instantly.
                        </p>
                    </div>
                </motion.div>

                {/* 4. Security & Vulnerability - Small */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.3 }}
                    className="col-span-1 md:col-span-1 lg:col-span-1 row-span-1 rounded-3xl bg-zinc-900/40 border border-zinc-800 p-6 flex flex-col relative overflow-hidden group hover:border-zinc-700 transition-colors"
                >
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Shield className="w-24 h-24 text-red-500" />
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center mb-4 relative z-10">
                        <Shield className="w-5 h-5 text-red-400" />
                    </div>
                    <div className="relative z-10 mt-auto">
                        <h3 className="text-lg font-bold text-white mb-2">Security Audit</h3>
                        <p className="text-zinc-400 text-xs leading-relaxed">
                            Detect exposed secrets and code vulnerabilities silently.
                        </p>
                    </div>
                </motion.div>

                {/* 5. GitHub Profiles - Medium */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.4 }}
                    className="col-span-1 md:col-span-2 lg:col-span-2 row-span-1 rounded-3xl bg-zinc-900/40 border border-zinc-800 p-8 flex flex-col justify-center relative overflow-hidden group hover:border-zinc-700 transition-colors"
                >
                    <div className="w-10 h-10 rounded-xl bg-pink-500/20 flex items-center justify-center mb-4 relative z-10">
                        <Users className="w-5 h-5 text-pink-400" />
                    </div>
                    <div className="relative z-10">
                        <h3 className="text-xl font-bold text-white mb-2">Developer Intel</h3>
                        <p className="text-zinc-400 text-sm leading-relaxed max-w-sm">
                            Analyze any developer's coding profile, expertise, and their highest impact open-source contributions.
                        </p>
                    </div>
                    <Activity className="absolute bottom-[-10%] right-[5%] w-48 h-48 text-pink-500/5 group-hover:text-pink-500/10 transition-colors duration-500 pointer-events-none" />
                </motion.div>

                {/* 6. Tech Stack - Medium */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.5 }}
                    className="col-span-1 md:col-span-1 lg:col-span-2 row-span-1 rounded-3xl bg-zinc-900/40 border border-zinc-800 p-8 flex flex-col justify-center relative overflow-hidden group hover:border-zinc-700 transition-colors"
                >
                    <div className="flex gap-4 items-center relative z-10">
                        <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
                            <Layers className="w-6 h-6 text-emerald-400" />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold text-white mb-1">Tech Stack Analyzer</h3>
                            <p className="text-zinc-400 text-sm leading-relaxed">
                                Instantly identify all frameworks, dependencies, and their versions used inside the repository.
                            </p>
                        </div>
                    </div>
                </motion.div>

            </div>
        </section>
    );
}
