"use client";

import { useState } from "react";
import { ShieldAlert, Loader2, ArrowLeftRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { motion } from "framer-motion";

export default function AdminAccessDeniedPage() {
    const [isSwitching, setIsSwitching] = useState(false);
    const router = useRouter();

    const handleSwitchAccount = async () => {
        setIsSwitching(true);
        await signOut({ callbackUrl: "/admin/stats" });
    };

    return (
        <div className="min-h-screen bg-black flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-md space-y-8 bg-zinc-900/50 border border-white/10 p-8 rounded-2xl backdrop-blur-sm"
            >
                <div className="text-center space-y-2">
                    <div className="inline-flex p-3 bg-amber-500/10 rounded-xl mb-4">
                        <ShieldAlert className="w-8 h-8 text-amber-400" />
                    </div>
                    <h1 className="text-2xl font-bold text-white">Access Denied</h1>
                    <p className="text-zinc-400 text-sm">
                        This GitHub account is not authorized to view admin analytics.
                    </p>
                </div>

                <div className="space-y-3">
                    <button
                        type="button"
                        onClick={handleSwitchAccount}
                        disabled={isSwitching}
                        className="w-full bg-white text-black font-semibold py-3 rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 group"
                    >
                        {isSwitching ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            <>
                                Switch GitHub Account
                                <ArrowLeftRight className="w-5 h-5 group-hover:scale-110 transition-transform" />
                            </>
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={() => router.push("/")}
                        className="w-full bg-zinc-800 text-zinc-200 font-medium py-3 rounded-lg hover:bg-zinc-700 transition-colors"
                    >
                        Back to Home
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
