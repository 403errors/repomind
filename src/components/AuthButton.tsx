"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { Github, LogOut, LayoutDashboard, User, Key, CheckCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { GitHubTokenModal } from "./GitHubTokenModal";
import { useGitHubToken } from "@/lib/use-github-token";

export default function AuthButton() {
    const { data: session, status } = useSession();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
    const { token, setToken, clearToken } = useGitHubToken();

    if (status === "loading") {
        return (
            <div className="h-10 w-24 bg-zinc-900 animate-pulse rounded-full border border-white/5" />
        );
    }

    return (
        <>
            <div className="flex items-center gap-2">
                <button
                    onClick={() => setIsTokenModalOpen(true)}
                    title={token ? "Using your GitHub token — click to manage" : "Use your GitHub token to remove rate limits"}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium border transition-all ${
                        token
                            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                            : "bg-zinc-900 border-white/5 text-zinc-500 hover:border-white/10 hover:text-zinc-300"
                    }`}
                >
                    {token ? (
                        <>
                            <CheckCircle className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Your token</span>
                        </>
                    ) : (
                        <>
                            <Key className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Add token</span>
                        </>
                    )}
                </button>

                {session ? (
                    <div className="relative">
                        <button
                            onClick={() => setIsMenuOpen(!isMenuOpen)}
                            className="flex items-center rounded-full bg-zinc-900 border border-white/10 hover:border-white/20 transition-all group overflow-hidden"
                        >
                            <div className="w-9 h-9 md:w-10 md:h-10 rounded-full overflow-hidden border border-white/10 group-hover:border-purple-500/50 transition-colors">
                                {session.user?.image ? (
                                    <Image
                                        src={session.user.image}
                                        alt={session.user.name || "User"}
                                        width={40}
                                        height={40}
                                        className="object-cover"
                                    />
                                ) : (
                                    <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                                        <User className="w-5 h-5 text-zinc-400" />
                                    </div>
                                )}
                            </div>
                        </button>

                        <AnimatePresence>
                            {isMenuOpen && (
                                <>
                                    <motion.div
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        onClick={() => setIsMenuOpen(false)}
                                        className="fixed inset-0 z-40"
                                    />
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                                        className="absolute right-0 mt-2 w-48 bg-zinc-900 border border-white/10 rounded-xl p-2 shadow-2xl z-50 backdrop-blur-xl"
                                    >
                                        <Link
                                            href="/dashboard"
                                            className="flex items-center gap-3 px-3 py-2 text-sm text-zinc-400 hover:text-white hover:bg-white/5 rounded-lg transition-all group"
                                            onClick={() => setIsMenuOpen(false)}
                                        >
                                            <LayoutDashboard className="w-4 h-4 group-hover:text-purple-400" />
                                            <span>Dashboard</span>
                                        </Link>
                                        <div className="h-px bg-white/5 my-1" />
                                        <button
                                            onClick={() => {
                                                signOut();
                                                setIsMenuOpen(false);
                                            }}
                                            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-zinc-400 hover:text-red-400 hover:bg-red-400/5 rounded-lg transition-all"
                                        >
                                            <LogOut className="w-4 h-4" />
                                            <span>Sign Out</span>
                                        </button>
                                    </motion.div>
                                </>
                            )}
                        </AnimatePresence>
                    </div>
                ) : (
                    <button
                        onClick={() => signIn("github")}
                        className="flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-zinc-800/80 to-zinc-900/80 border border-zinc-700/50 hover:border-zinc-500/50 backdrop-blur-md transition-all font-medium text-sm text-white shadow-lg group"
                    >
                        <Github className="w-4 h-4 text-white hidden md:block" />
                        <span className="hidden md:inline">Sign in with GitHub</span>
                        <span className="md:hidden">Sign In</span>
                    </button>
                )}
            </div>

            <GitHubTokenModal
                isOpen={isTokenModalOpen}
                onClose={() => setIsTokenModalOpen(false)}
                currentToken={token}
                onSave={setToken}
                onClear={clearToken}
            />
        </>
    );
}
