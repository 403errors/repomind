"use client";

import { Clock3, Wrench, X } from "lucide-react";

type ToolQuotaScope = "repo" | "profile";
type ToolQuotaAudience = "anonymous" | "authenticated";

interface ToolQuotaModalProps {
    isOpen: boolean;
    onClose: () => void;
    scope: ToolQuotaScope;
    audience: ToolQuotaAudience;
    used: number;
    limit: number;
    remaining: number;
    resetCountdown: string;
    supportEmail: string;
}

export function ToolQuotaModal({
    isOpen,
    onClose,
    scope,
    audience,
    used,
    limit,
    remaining,
    resetCountdown,
    supportEmail,
}: ToolQuotaModalProps) {
    if (!isOpen) {
        return null;
    }

    const scopeLabel = scope === "repo" ? "Repo chat tools" : "Profile chat tools";
    const authNote = audience === "anonymous"
        ? "Sign in to unlock 30 tool calls per day."
        : "Tool calling is disabled until the window resets.";

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md overflow-hidden flex flex-col relative shadow-2xl">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors z-10"
                    title="Close"
                >
                    <X className="w-5 h-5" />
                </button>

                <div className="p-6">
                    <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center mb-6 border border-amber-500/20">
                        <Wrench className="w-6 h-6 text-amber-400" />
                    </div>

                    <h2 className="text-xl font-bold text-white mb-2 pr-8">
                        Tool Calls Paused
                    </h2>
                    <p className="text-zinc-300 text-sm leading-relaxed">
                        {scopeLabel} reached the current window limit.
                    </p>

                    <div className="mt-4 rounded-xl border border-white/10 bg-zinc-950/70 p-3 text-sm">
                        <div className="flex items-center justify-between text-zinc-300">
                            <span>Remaining</span>
                            <span className="font-semibold text-white">{remaining} / {limit}</span>
                        </div>
                        <div className="flex items-center justify-between text-zinc-300">
                            <span>Usage</span>
                            <span className="font-semibold text-white">{used} / {limit}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-zinc-300">
                            <span className="flex items-center gap-1.5">
                                <Clock3 className="w-3.5 h-3.5 text-blue-300" />
                                Reset in
                            </span>
                            <span className="font-semibold text-blue-300">{resetCountdown}</span>
                        </div>
                    </div>

                    <p className="text-zinc-400 text-sm mt-4 leading-relaxed">
                        {authNote}
                    </p>
                    <p className="text-zinc-500 text-xs mt-2 leading-relaxed">
                        Need extended limits? Contact {supportEmail}.
                    </p>

                    <button
                        onClick={onClose}
                        className="mt-6 w-full px-4 py-3 rounded-xl bg-white text-black font-semibold hover:bg-zinc-200 transition-all shadow-lg"
                    >
                        Continue
                    </button>
                </div>
            </div>
        </div>
    );
}
