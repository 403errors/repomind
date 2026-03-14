import { Shield, Sparkles, X } from "lucide-react";

import { DEEP_SCAN_FILE_LIMIT, QUICK_SCAN_FILE_LIMIT } from "@/lib/chat-constants";

interface DeepScansData {
    used: number;
    total: number;
    resetsAt: string;
    isUnlimited: boolean;
}

interface SecurityScanModalProps {
    isOpen: boolean;
    isAuthenticated: boolean;
    deepScansData: DeepScansData | null;
    latestScanId?: string | null;
    onClose: () => void;
    onRunQuickScan: (scanAiAssist: boolean) => void;
    onRunDeepScan: (scanAiAssist: boolean) => void;
}

export function SecurityScanModal({
    isOpen,
    isAuthenticated,
    deepScansData,
    latestScanId,
    onClose,
    onRunQuickScan,
    onRunDeepScan,
}: SecurityScanModalProps) {
    const scanAiAssist = true;

    if (!isOpen) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md overflow-hidden flex flex-col relative shadow-2xl">
                <button
                    onClick={() => {
                        onClose();
                    }}
                    className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors z-10"
                >
                    <X className="w-5 h-5" />
                </button>
                <div className="p-6">
                    <h2 className="text-xl font-bold text-white mb-2 pr-8 flex items-center gap-2">
                        <Shield className="w-6 h-6 text-red-400" />
                        Security Check
                    </h2>
                    <p className="text-zinc-400 text-sm mb-6">Choose the depth of your security analysis.</p>

                    <div className="space-y-4">
                        <button
                            onClick={() => {
                                onRunQuickScan(scanAiAssist);
                            }}
                            className="w-full bg-zinc-800 hover:bg-zinc-700 border border-white/5 rounded-xl p-4 text-left transition-all group"
                        >
                            <div className="flex items-center justify-between mb-1">
                                <h3 className="text-white font-medium group-hover:text-red-300 transition-colors">Quick Scan</h3>
                                <span className="text-xs font-mono bg-zinc-950 px-2 py-0.5 rounded text-zinc-400">~ 30 sec</span>
                            </div>
                            <p className="text-xs text-zinc-400 leading-relaxed">
                                Analyzes up to {QUICK_SCAN_FILE_LIMIT} files. Automatically flags potential secrets and common injection points. Fast and low-latency.
                            </p>
                        </button>

                        <button
                            onClick={() => {
                                onRunDeepScan(scanAiAssist);
                            }}
                            className="w-full bg-zinc-800 hover:bg-zinc-700 border border-red-500/20 rounded-xl p-4 text-left transition-all group"
                        >
                            <div className="flex items-center justify-between mb-1">
                                <h3 className="text-white font-medium flex items-center gap-2 group-hover:text-red-300 transition-colors">
                                    Deep Scan
                                    <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                                </h3>
                                <div className="flex flex-col items-end">
                                    <span className="text-xs font-mono bg-zinc-950 px-2 py-0.5 rounded text-zinc-400">~ 2 min</span>
                                    {isAuthenticated && deepScansData && (
                                        <span className="text-[10px] text-zinc-500 mt-1">
                                            {deepScansData.isUnlimited
                                                ? "Unlimited (Admin)"
                                                : `${deepScansData.total - deepScansData.used} / ${deepScansData.total} remaining`}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <p className="text-xs text-zinc-400 leading-relaxed">
                                Analyzes up to {DEEP_SCAN_FILE_LIMIT} files. Runs broader deterministic analysis with required thinking AI assistance.
                            </p>
                        </button>

                        <div
                            aria-disabled="true"
                            className="w-full bg-zinc-900 border border-zinc-700/60 rounded-xl p-4 text-left opacity-75 cursor-not-allowed"
                        >
                            <div className="flex items-center justify-between mb-1">
                                <h3 className="text-zinc-200 font-medium flex items-center gap-2">
                                    Full Repo Scan
                                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-700/40 text-zinc-300 border border-zinc-600/60">
                                        Coming soon
                                    </span>
                                </h3>
                                <span className="text-xs font-mono bg-zinc-950 px-2 py-0.5 rounded text-zinc-500">3/month</span>
                            </div>
                            <p className="text-xs text-zinc-400 leading-relaxed">
                                Recommended for repositories with more than 500 files.
                            </p>
                        </div>

                        <label className="flex items-start gap-3 p-3 rounded-xl border border-red-500/20 bg-zinc-950/60">
                            <input
                                type="checkbox"
                                checked={true}
                                readOnly
                                disabled
                                className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-red-500 focus:ring-red-500/60"
                            />
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-semibold text-zinc-200">Thinking AI assist enabled</span>
                                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30">
                                        Required
                                    </span>
                                </div>
                                <span className="text-xs text-zinc-400 leading-relaxed">
                                    Security scans always run with AI assist enabled for deeper reasoning and verification quality.
                                </span>
                            </div>
                        </label>

                        {latestScanId && (
                            <div className="pt-2 border-t border-white/5">
                                <a
                                    href={`/report/${latestScanId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="w-full flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 py-3 rounded-xl text-sm font-semibold transition-all border border-red-500/20"
                                >
                                    <Shield className="w-4 h-4" />
                                    View Latest Security Report
                                </a>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
