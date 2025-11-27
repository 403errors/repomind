"use client";

import { createPortal } from "react-dom";
import { X, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface WhatsNewModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function WhatsNewModal({ isOpen, onClose }: WhatsNewModalProps) {
    if (!isOpen) return null;

    const versions = [
        {
            version: "v1.3.1",
            isNew: true,
            features: [
                "Increased accuracy in complex flowchart generation from 70% to 95+%",
                "Improved error handling: Mermaid syntax errors are now hidden from the UI",
                "Added context for better chat results"
            ]
        },
        {
            version: "v1.3",
            isNew: false,
            features: [
                "Introduced the codeblocks in chat UI for code display with horizontal scrolling",
                "Integrated an enhanced flowchart diagrams.",
                "Added hidden files section to optimise the repo tree.",
                "Implemented the devtools",
                "Added realtime next js server response",
                "Introduced the Vercel KV caching for GitHub API calls",
                "Robust mermaid diagram fix pipeline using JSON by LLM to mermaid by typescript."
            ]
        },
        {
            version: "v1.2",
            isNew: false,
            features: [
                "Dev Tools Suite: Advanced Search (Regex/AST), Code Quality Analysis, and Automated Generators.",
                "Zero-Cost Security: Vulnerability scanning using pattern matching and Gemini AI.",
                "Enhanced Data: Precise language statistics via GraphQL and commit history.",
                "Auto-Persistence: Conversations are now automatically saved locally and restored instantly."
            ]
        },
        {
            version: "v1.1",
            isNew: false,
            features: [
                "Smart Caching: Instant load times for previously visited profiles and repositories.",
                "Mobile Experience: Optimized layout for mobile devices.",
                "Repo Chat: Deep dive into repositories with AI-powered chat and file analysis.",
                "File Preview: Instant syntax-highlighted previews for any file in the repository."
            ]
        }
    ];

    return typeof document !== 'undefined' ? createPortal(
        <AnimatePresence>
            <div className="fixed inset-0 z-[1000] flex items-center justify-center p-2 md:p-4">
                {/* Backdrop */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                    onClick={onClose}
                />

                {/* Modal */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative w-full max-w-2xl max-h-[90vh] md:max-h-[85vh] bg-zinc-900 border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 md:p-6 border-b border-white/10 bg-gradient-to-r from-purple-600/10 to-blue-600/10">
                        <div className="flex items-center gap-3">
                            <div className="p-1.5 md:p-2 bg-purple-600 rounded-lg">
                                <Sparkles className="w-5 h-5 md:w-6 md:h-6 text-white" />
                            </div>
                            <div>
                                <h2 className="text-xl md:text-2xl font-bold text-white">What's New</h2>
                                <p className="text-xs md:text-sm text-zinc-400">Latest updates and improvements</p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5 text-zinc-400 hover:text-white" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto p-4 md:p-6">
                        <div className="flex flex-col gap-8">
                            {versions.map((version, vIndex) => (
                                <div key={version.version} className="relative">
                                    <div className="flex items-center gap-3 mb-4">
                                        <h3 className="text-xl font-bold text-white">{version.version}</h3>
                                        {version.isNew && (
                                            <span className="px-2 py-0.5 text-[10px] font-bold tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded-full">
                                                LATEST
                                            </span>
                                        )}
                                    </div>

                                    <ul className="space-y-3">
                                        {version.features.map((feature, fIndex) => (
                                            <motion.li
                                                key={fIndex}
                                                initial={{ opacity: 0, x: -10 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ delay: (vIndex * 0.1) + (fIndex * 0.05) }}
                                                className="flex items-start gap-3 text-zinc-300"
                                            >
                                                <span className="mt-2 w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0" />
                                                <span className="leading-relaxed">{feature}</span>
                                            </motion.li>
                                        ))}
                                    </ul>

                                    {vIndex < versions.length - 1 && (
                                        <div className="mt-8 h-px bg-white/10" />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-white/10 bg-zinc-900/80 backdrop-blur-sm text-center">
                        <p className="text-sm text-zinc-500">
                            More features coming soon! Stay tuned 🚀
                        </p>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>,
        document.body
    ) : null;
}
