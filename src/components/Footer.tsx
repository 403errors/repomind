"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquarePlus, X, Copy, Check } from "lucide-react";
import { toast } from "sonner";

export default function Footer() {
    const [isOpen, setIsOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const email = "pieisnot22by7@gmail.com";

    const handleCopy = () => {
        navigator.clipboard.writeText(email);
        setCopied(true);
        toast.success("Email copied to clipboard!");
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <footer className="relative z-10 py-8 border-t border-white/5 bg-black/20 backdrop-blur-sm">
            <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
                <p className="text-zinc-500 text-sm">
                    © {new Date().getFullYear()} RepoMind. All rights reserved.
                </p>

                <button
                    onClick={() => setIsOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-900/50 border border-white/10 text-zinc-400 hover:text-white hover:border-white/20 transition-all text-sm group"
                >
                    <MessageSquarePlus className="w-4 h-4 group-hover:text-purple-400 transition-colors" />
                    <span>Request a feature / Report a bug</span>
                </button>
            </div>

            {/* Contact Popup */}
            {typeof document !== 'undefined' && createPortal(
                <AnimatePresence>
                    {isOpen && (
                        <>
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                onClick={() => setIsOpen(false)}
                                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
                            />
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95, x: "-50%", y: "-45%" }}
                                animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
                                exit={{ opacity: 0, scale: 0.95, x: "-50%", y: "-45%" }}
                                className="fixed left-1/2 top-1/2 w-full max-w-md bg-zinc-900 border border-white/10 rounded-2xl p-6 shadow-2xl z-[101]"
                            >
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="text-xl font-semibold text-white">Get in touch</h3>
                                    <button
                                        onClick={() => setIsOpen(false)}
                                        className="p-2 text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>

                                <p className="text-zinc-400 mb-6">
                                    Found a bug or have a feature request? We&apos;d love to hear from you! Drop us an email at:
                                </p>

                                <div className="flex items-center gap-2 p-3 bg-black/50 rounded-xl border border-white/5 group">
                                    <code className="flex-1 text-zinc-300 font-mono text-sm break-all">
                                        {email}
                                    </code>
                                    <button
                                        onClick={handleCopy}
                                        className="p-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                        title="Copy email"
                                    >
                                        {copied ? (
                                            <Check className="w-4 h-4 text-green-400" />
                                        ) : (
                                            <Copy className="w-4 h-4" />
                                        )}
                                    </button>
                                </div>

                                <div className="mt-6 flex justify-end">
                                    <button
                                        onClick={() => window.location.href = `mailto:${email}`}
                                        className="px-4 py-2 bg-white text-black rounded-lg font-medium hover:bg-zinc-200 transition-colors text-sm"
                                    >
                                        Send Email
                                    </button>
                                </div>
                            </motion.div>
                        </>
                    )}
                </AnimatePresence>,
                document.body
            )}
        </footer>
    );
}
