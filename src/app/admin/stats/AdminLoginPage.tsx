"use client";

import { useState } from "react";
import { Lock, Loader2, ArrowRight } from "lucide-react";
import { verifyAdminPassword } from "@/app/actions";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

export default function AdminLoginPage() {
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            const result = await verifyAdminPassword(password);
            if (result.success) {
                router.refresh(); // Refresh to show the dashboard
            } else {
                setError(result.error || "Invalid password");
            }
        } catch (err) {
            setError("Something went wrong. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-black flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-md space-y-8 bg-zinc-900/50 border border-white/10 p-8 rounded-2xl backdrop-blur-sm"
            >
                <div className="text-center space-y-2">
                    <div className="inline-flex p-3 bg-purple-500/10 rounded-xl mb-4">
                        <Lock className="w-8 h-8 text-purple-400" />
                    </div>
                    <h1 className="text-2xl font-bold text-white">Admin Access</h1>
                    <p className="text-zinc-400 text-sm">Please enter the administrator password to continue.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <div className="relative group">
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Enter password"
                                className="w-full bg-black border border-white/10 rounded-lg px-4 py-3 outline-none focus:border-purple-500/50 transition-colors text-white placeholder-zinc-600"
                                autoFocus
                            />
                        </div>
                        {error && (
                            <p className="text-red-400 text-sm pl-1">{error}</p>
                        )}
                    </div>

                    <button
                        type="submit"
                        disabled={loading || !password}
                        className="w-full bg-white text-black font-semibold py-3 rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 group"
                    >
                        {loading ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            <>
                                Unlock Dashboard
                                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                            </>
                        )}
                    </button>
                </form>

                <div className="pt-4 text-center">
                    <button
                        onClick={() => router.push('/')}
                        className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
                    >
                        Back to Home
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
