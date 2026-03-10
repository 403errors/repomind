"use client";

import Link from "next/link";
import type { ReportFalsePositiveReason } from "@prisma/client";
import { useEffect, useMemo, useState } from "react";
import type { StoredScan } from "@/lib/services/scan-storage";
import type { PriorScanDiff, ReportFindingView } from "@/lib/services/report-service";
import { getCanonicalSiteUrl } from "@/lib/site-url";
import {
    submitReportFalsePositive,
    trackReportConversion,
} from "@/app/actions";
import { CodeBlock } from "@/components/CodeBlock";
import {
    AlertCircle,
    AlertTriangle,
    CheckCircle,
    ChevronDown,
    Copy,
    Flame,
    Info,
    MessageCircle,
    Shield,
    ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { formatReportCountdown, getReportExpiryState } from "@/app/report/report-expiry";
import ShareButton from "./ShareButton";
import { ExportButtons } from "./components/ExportButtons";

const severityConfig = {
    critical: { color: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/20", icon: Flame },
    high: { color: "text-orange-500", bg: "bg-orange-500/10", border: "border-orange-500/20", icon: AlertTriangle },
    medium: { color: "text-yellow-500", bg: "bg-yellow-500/10", border: "border-yellow-500/20", icon: AlertCircle },
    low: { color: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20", icon: Info },
    info: { color: "text-zinc-400", bg: "bg-zinc-500/10", border: "border-zinc-500/20", icon: CheckCircle },
} as const;

const confidenceConfig = {
    high: { label: "High Confidence", className: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10" },
    medium: { label: "Medium Confidence", className: "text-yellow-300 border-yellow-500/30 bg-yellow-500/10" },
    low: { label: "Low Confidence", className: "text-zinc-300 border-zinc-500/30 bg-zinc-500/10" },
} as const;

const falsePositiveReasonOptions: Array<{
    value: ReportFalsePositiveReason;
    label: string;
    description: string;
}> = [
    {
        value: "NOT_A_VULNERABILITY",
        label: "Not a vulnerability",
        description: "The finding is technically incorrect for this code path.",
    },
    {
        value: "TEST_OR_FIXTURE",
        label: "Test or fixture only",
        description: "The finding points to non-production code or seeded test data.",
    },
    {
        value: "FALSE_DATAFLOW",
        label: "False dataflow",
        description: "The scanner connected source and sink incorrectly.",
    },
    {
        value: "INTENDED_BEHAVIOR",
        label: "Intended behavior",
        description: "The flagged pattern is deliberate and already protected by surrounding controls.",
    },
    {
        value: "OTHER",
        label: "Other",
        description: "Use this when none of the standard categories fit.",
    },
];

function SeverityBadge({ severity }: { severity: keyof typeof severityConfig }) {
    const config = severityConfig[severity] || severityConfig.info;
    const Icon = config.icon;

    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${config.bg} ${config.color} border ${config.border}`}>
            <Icon className="w-3.5 h-3.5" />
            <span className="uppercase tracking-wider">{severity}</span>
        </span>
    );
}

function ConfidenceBadge({ confidence }: { confidence?: ReportFindingView["finding"]["confidence"] }) {
    if (!confidence) {
        return (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border border-zinc-700 bg-zinc-800 text-zinc-300">
                Confidence: Not Scored
            </span>
        );
    }

    const config = confidenceConfig[confidence];
    return (
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${config.className}`}>
            {config.label}
        </span>
    );
}

interface ReportContentProps {
    scan: StoredScan;
    priorScanDiff: PriorScanDiff;
    topFixes: ReportFindingView[];
    findingViews: ReportFindingView[];
    globalFixPrompt: string;
    globalChatHref: string;
    hasPreviousScan: boolean;
    isSharedView: boolean;
    canShareReport: boolean;
    canGenerateOutreach: boolean;
    shareMode: "canonical" | "copy-current-url";
    reportExpiresAt: number;
}

export function ReportContent({
    scan,
    priorScanDiff,
    topFixes,
    findingViews,
    globalFixPrompt,
    hasPreviousScan,
    isSharedView,
    canShareReport,
    canGenerateOutreach,
    shareMode,
    reportExpiresAt,
}: ReportContentProps) {
    const baseUrl = getCanonicalSiteUrl();
    const date = new Date(scan.timestamp);
    const [now, setNow] = useState(() => Date.now());
    const [showFixPromptModal, setShowFixPromptModal] = useState(false);
    const [isCopyingFixPrompt, setIsCopyingFixPrompt] = useState(false);
    const [pendingFalsePositives, setPendingFalsePositives] = useState<Record<string, boolean>>({});
    const [activeFalsePositiveKey, setActiveFalsePositiveKey] = useState<string | null>(null);
    const [falsePositiveReason, setFalsePositiveReason] = useState<ReportFalsePositiveReason>("NOT_A_VULNERABILITY");
    const [falsePositiveDetails, setFalsePositiveDetails] = useState("");
    const [isMobileActionsOpen, setIsMobileActionsOpen] = useState(false);

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            setNow(Date.now());
        }, 60_000);

        return () => window.clearInterval(intervalId);
    }, []);

    const expiryState = useMemo(
        () => getReportExpiryState(reportExpiresAt, now),
        [reportExpiresAt, now]
    );
    const isOutdated = expiryState.isExpired;
    const expiryLabel = formatReportCountdown(reportExpiresAt, now);
    const repoChatHref = `/chat?q=${encodeURIComponent(`${scan.owner}/${scan.repo}`)}`;
    const repoProfileHref = `/repo/${scan.owner}/${scan.repo}`;

    const topFixesByFingerprint = useMemo(() => {
        const fpSet = new Set(topFixes.map((item) => item.fingerprint));
        return findingViews.filter((view) => fpSet.has(view.fingerprint)).slice(0, 3);
    }, [findingViews, topFixes]);

    const openFixPromptModal = () => {
        if (isOutdated || findingViews.length === 0) return;
        setShowFixPromptModal(true);
    };

    const closeFixPromptModal = () => {
        if (isCopyingFixPrompt) return;
        setShowFixPromptModal(false);
    };

    const handleCopyFixPrompt = async () => {
        if (isOutdated || findingViews.length === 0) return;

        setIsCopyingFixPrompt(true);
        try {
            await navigator.clipboard.writeText(globalFixPrompt);
            void trackReportConversion("report_fix_prompt_copied", scan.id);
            toast.success("Fix prompt copied. Paste it in Repo Chat to remediate vulnerabilities.");
            setShowFixPromptModal(false);
        } catch {
            toast.error("Failed to copy prompt");
        } finally {
            setIsCopyingFixPrompt(false);
        }
    };

    const activeFalsePositiveView = useMemo(() => {
        if (!activeFalsePositiveKey) return null;
        return findingViews.find((view) => `${view.fingerprint}:${view.index}` === activeFalsePositiveKey) ?? null;
    }, [activeFalsePositiveKey, findingViews]);
    const isActiveFalsePositivePending = activeFalsePositiveKey
        ? Boolean(pendingFalsePositives[activeFalsePositiveKey])
        : false;

    const closeFalsePositiveModal = () => {
        setActiveFalsePositiveKey(null);
        setFalsePositiveReason("NOT_A_VULNERABILITY");
        setFalsePositiveDetails("");
    };

    const openFalsePositiveModal = (view: ReportFindingView) => {
        setActiveFalsePositiveKey(`${view.fingerprint}:${view.index}`);
        setFalsePositiveReason("NOT_A_VULNERABILITY");
        setFalsePositiveDetails("");
    };

    const handleFalsePositiveSubmit = async () => {
        if (!activeFalsePositiveView) return;

        const key = `${activeFalsePositiveView.fingerprint}:${activeFalsePositiveView.index}`;
        setPendingFalsePositives((current) => ({ ...current, [key]: true }));

        try {
            await submitReportFalsePositive({
                scanId: scan.id,
                findingIndex: activeFalsePositiveView.index,
                findingFingerprint: activeFalsePositiveView.fingerprint,
                isSharedView,
                reason: falsePositiveReason,
                details: falsePositiveDetails,
            });
            toast.success("False positive submitted");
            closeFalsePositiveModal();
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to submit false positive";
            toast.error(message);
        } finally {
            setPendingFalsePositives((current) => {
                const next = { ...current };
                delete next[key];
                return next;
            });
        }
    };

    return (
        <div className="min-h-screen bg-black text-white p-4 md:p-8 selection:bg-indigo-500/30">
            <div className="max-w-4xl mx-auto space-y-8">
                <div data-testid="report-actions-navbar" className="print:hidden">
                    <div className="rounded-2xl border border-white/10 bg-zinc-950/80 p-4 shadow-lg md:hidden">
                        <div className="flex items-center justify-between gap-3">
                            <span className="inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">
                                <Shield className="w-3.5 h-3.5" />
                                Report Actions
                            </span>
                            <button
                                type="button"
                                onClick={() => setIsMobileActionsOpen((current) => !current)}
                                className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-zinc-900 p-2 text-zinc-300 transition-colors hover:bg-zinc-800"
                                aria-expanded={isMobileActionsOpen}
                                aria-controls="report-actions-mobile-menu"
                            >
                                <ChevronDown className={`h-4 w-4 transition-transform ${isMobileActionsOpen ? "rotate-180" : ""}`} />
                                <span className="sr-only">{isMobileActionsOpen ? "Collapse report actions" : "Expand report actions"}</span>
                            </button>
                        </div>

                        {isMobileActionsOpen && (
                            <div id="report-actions-mobile-menu" className="mt-3 flex flex-col gap-2">
                                {isOutdated ? (
                                    <Link
                                        href={repoChatHref}
                                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-indigo-500"
                                    >
                                        <MessageCircle className="w-4 h-4" />
                                        Rescan in Repo Chat
                                    </Link>
                                ) : (
                                    <>
                                        <Link
                                            href={repoChatHref}
                                            className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-800 px-3.5 py-2 text-sm font-medium text-white transition-all hover:bg-zinc-700"
                                        >
                                            <MessageCircle className="w-4 h-4" />
                                            Talk to the Codebase
                                        </Link>
                                        {canShareReport && (
                                            <ShareButton
                                                scanId={scan.id}
                                                canGenerateOutreach={canGenerateOutreach}
                                                shareMode={shareMode}
                                                reportExpiresAt={reportExpiresAt}
                                            />
                                        )}
                                        <button
                                            onClick={openFixPromptModal}
                                            disabled={findingViews.length === 0}
                                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-zinc-800 px-3.5 py-2 text-sm font-medium text-zinc-200 transition-all hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            <Copy className="w-4 h-4" />
                                            Get LLM-Ready Fix Prompt
                                        </button>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="hidden md:block sticky top-0 z-50 rounded-2xl border border-white/10 bg-zinc-950/80 p-4 md:p-5 backdrop-blur-xl shadow-lg">
                        <div className="flex flex-col gap-4">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">
                                        <Shield className="w-3.5 h-3.5" />
                                        Report Actions
                                    </span>
                                    {isSharedView && (
                                        <span className="inline-flex items-center rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-indigo-300">
                                            Shared Link
                                        </span>
                                    )}
                                </div>
                                {isOutdated && (
                                    <Link
                                        href={repoChatHref}
                                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-indigo-500"
                                    >
                                        <MessageCircle className="w-4 h-4" />
                                        Rescan in Repo Chat
                                    </Link>
                                )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                {!isOutdated && (
                                    <Link
                                        href={repoChatHref}
                                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-800 px-3.5 py-2 text-sm font-medium text-white transition-all hover:bg-zinc-700"
                                    >
                                        <MessageCircle className="w-4 h-4" />
                                        Talk to the Codebase
                                    </Link>
                                )}
                                {!isOutdated && canShareReport && (
                                    <ShareButton
                                        scanId={scan.id}
                                        canGenerateOutreach={canGenerateOutreach}
                                        shareMode={shareMode}
                                        reportExpiresAt={reportExpiresAt}
                                    />
                                )}
                                {!isOutdated && (
                                    <button
                                        onClick={openFixPromptModal}
                                        disabled={findingViews.length === 0}
                                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-zinc-800 px-3.5 py-2 text-sm font-medium text-zinc-200 transition-all hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <Copy className="w-4 h-4" />
                                        Get LLM-Ready Fix Prompt
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-xl">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 text-indigo-400">
                                <Shield className="w-5 h-5" />
                                <span className="text-sm font-medium tracking-wide uppercase">
                                    REPOMIND SECURITY REPORT
                                </span>
                            </div>
                            <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
                                <span className="font-normal text-zinc-500">{scan.owner} / </span>
                                {scan.repo}
                            </h1>
                            <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-400">
                                <span>Scanned on {date.toLocaleDateString()} at {date.toLocaleTimeString()}</span>
                                <span className="hidden sm:inline">•</span>
                                <span className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs">
                                    {scan.depth === "deep" ? "Deep Analysis" : "Quick Scan"}
                                </span>
                                <span className={`rounded-md border px-2 py-0.5 text-xs ${isOutdated ? "border-red-500/20 bg-red-500/10 text-red-300" : "border-amber-500/20 bg-amber-500/10 text-amber-300"}`}>
                                    {isOutdated ? "Outdated" : `Expires in ${expiryLabel}`}
                                </span>
                            </div>
                        </div>
                        <div className="print:hidden flex flex-col gap-3 lg:items-end">
                            <Link
                                href={repoProfileHref}
                                className="inline-flex items-center justify-center gap-2 rounded-lg border border-indigo-500/50 bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white transition-all hover:bg-indigo-500"
                            >
                                <Shield className="w-4 h-4" />
                                Repository Profile
                            </Link>
                            <ExportButtons scan={scan} />
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                    {(Object.keys(severityConfig) as Array<keyof typeof severityConfig>).map((sev) => {
                        const count = scan.summary[sev] || 0;
                        const config = severityConfig[sev];
                        const Icon = config.icon;

                        return (
                            <div key={sev} className={`flex flex-col items-center justify-center rounded-xl border p-4 text-center ${count > 0 ? config.border : "border-white/5"} ${count > 0 ? config.bg : "bg-zinc-900/50"}`}>
                                <div className="mb-2 flex items-center gap-2">
                                    <Icon className={`w-4 h-4 ${count > 0 ? config.color : "text-zinc-600"}`} />
                                    <span className={`text-xs font-semibold uppercase tracking-wider ${count > 0 ? config.color : "text-zinc-500"}`}>{sev}</span>
                                </div>
                                <span className={`text-3xl font-bold ${count > 0 ? "text-white" : "text-zinc-700"}`}>{count}</span>
                            </div>
                        );
                    })}
                </div>

                <div className="rounded-2xl border border-white/10 bg-zinc-900/70 p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="text-lg font-medium text-zinc-100">What Changed Since Last Scan</h3>
                        <span className="rounded-full border border-white/10 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-400">
                            {hasPreviousScan ? "Compared to previous scan" : "Baseline scan"}
                        </span>
                    </div>
                    <p className="mt-2 text-sm text-zinc-400">
                        {hasPreviousScan
                            ? "Use this delta to prioritize newly introduced risk, then resolve historical findings."
                            : "No earlier scan found for this repository yet. This report is your baseline for future change tracking."}
                    </p>
                    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4">
                            <p className="text-xs uppercase tracking-wider text-red-300">New</p>
                            <p className="mt-1 text-2xl font-bold text-white">{priorScanDiff.new}</p>
                        </div>
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                            <p className="text-xs uppercase tracking-wider text-emerald-300">Resolved</p>
                            <p className="mt-1 text-2xl font-bold text-white">{priorScanDiff.resolved}</p>
                        </div>
                        <div className="rounded-xl border border-zinc-500/20 bg-zinc-500/10 p-4">
                            <p className="text-xs uppercase tracking-wider text-zinc-300">Unchanged</p>
                            <p className="mt-1 text-2xl font-bold text-white">{priorScanDiff.unchanged}</p>
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="rounded-2xl border border-white/10 bg-zinc-900 p-6 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <h3 className="text-lg font-medium text-zinc-100">Fix These First</h3>
                            <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-zinc-400">
                                Ranked by impact, confidence, and exploitability
                            </span>
                        </div>
                        {topFixesByFingerprint.length === 0 ? (
                            <div className="rounded-xl border border-white/5 bg-zinc-950/60 p-4 text-sm text-zinc-400">
                                No vulnerabilities to prioritize in this scan.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {topFixesByFingerprint.map((view, rank) => (
                                    <div key={`${view.fingerprint}:${rank}`} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-zinc-950/50 p-4">
                                        <div className="space-y-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1 text-xs font-semibold text-indigo-300">
                                                    Priority #{rank + 1}
                                                </span>
                                                <SeverityBadge severity={view.finding.severity as keyof typeof severityConfig} />
                                                <ConfidenceBadge confidence={view.finding.confidence} />
                                            </div>
                                            <p className="text-sm font-medium text-zinc-100">{view.finding.title}</p>
                                            <p className="text-xs text-zinc-400">
                                                {view.finding.file}{view.finding.line ? `:${view.finding.line}` : ""} • Triage score {view.triageScore}
                                            </p>
                                            <p className="text-sm text-zinc-300">{view.impact}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <h3 className="border-b border-white/10 pb-2 text-lg font-medium">Detailed Findings ({findingViews.length})</h3>

                    {findingViews.length === 0 ? (
                        <div className="rounded-xl border border-white/5 bg-zinc-900/50 p-8 text-center">
                            <CheckCircle className="mx-auto mb-4 h-12 w-12 text-green-500 opacity-50" />
                            <h4 className="mb-1 font-medium text-zinc-300">No vulnerabilities found</h4>
                            <p className="text-sm text-zinc-500">This repository looks clean based on the scan configuration.</p>
                        </div>
                    ) : (
                        findingViews.map((view) => {
                            const key = `${view.fingerprint}:${view.index}`;

                            return (
                                <div key={key} className="overflow-hidden rounded-xl border border-white/10 bg-zinc-900 shadow-lg" style={{ pageBreakInside: "avoid" }}>
                                    <div className="flex flex-col gap-4 border-b border-white/5 bg-zinc-950/50 p-5 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="space-y-2">
                                            <div className="flex flex-wrap items-center gap-3">
                                                <SeverityBadge severity={view.finding.severity as keyof typeof severityConfig} />
                                                <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-mono text-zinc-300">
                                                    {view.finding.type}
                                                </span>
                                                <ConfidenceBadge confidence={view.finding.confidence} />
                                                {(view.finding.cwe || view.finding.cvss) && (
                                                    <span className="flex items-center gap-2 text-xs text-zinc-500">
                                                        {view.finding.cwe && <span>{view.finding.cwe}</span>}
                                                        {view.finding.cvss && <span>CVSS: {view.finding.cvss}</span>}
                                                    </span>
                                                )}
                                            </div>
                                            <h4 className="text-lg font-medium text-zinc-100">{view.finding.title}</h4>
                                        </div>
                                        <div className="print:hidden flex items-center gap-2">
                                            <button
                                                onClick={() => openFalsePositiveModal(view)}
                                                disabled={Boolean(pendingFalsePositives[key])}
                                                className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3.5 py-2 text-sm font-semibold text-zinc-300 transition-all hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
                                            >
                                                <ShieldAlert className="w-4 h-4" />
                                                {pendingFalsePositives[key] ? "Submitting..." : "False Positive"}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="space-y-6 p-5">
                                        <div className="space-y-2">
                                            <h5 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Proof</h5>
                                            <div className="whitespace-pre-wrap rounded-lg border border-white/10 bg-zinc-950/70 p-4 text-sm text-zinc-300">
                                                {view.proof}
                                            </div>
                                            <p className="text-xs text-zinc-500">{view.confidenceRationale}</p>
                                        </div>

                                        <div className="space-y-2">
                                            <h5 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Impact</h5>
                                            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-100">
                                                {view.impact}
                                            </div>
                                        </div>

                                        <div className="flex flex-col space-y-2">
                                            <h5 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Recommendation</h5>
                                            <div className="rounded-lg border border-indigo-500/10 bg-indigo-500/5 p-4">
                                                <p className="text-sm text-indigo-200">{view.finding.recommendation}</p>
                                            </div>
                                        </div>

                                        {view.finding.snippet && (
                                            <div className="space-y-2 pt-2">
                                                <h5 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Context Snippet</h5>
                                                <CodeBlock
                                                    language={view.finding.file.split(".").pop() || "text"}
                                                    value={view.finding.snippet}
                                                />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                <div className="no-export pt-8 text-center text-sm text-zinc-600">
                    <p>Generated by <a href={baseUrl} className="font-semibold text-zinc-500 transition-colors hover:text-indigo-400">RepoMind</a> — The AI developer sidekick.</p>
                </div>
            </div>

            {showFixPromptModal && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                        onClick={closeFixPromptModal}
                    />
                    <div className="relative w-full max-w-3xl rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl">
                        <div className="space-y-4 p-6">
                            <div className="space-y-2">
                                <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300">
                                    <Copy className="w-3.5 h-3.5" />
                                    LLM-Ready Prompt
                                </div>
                                <h3 className="text-xl font-semibold text-white">Preview Fix Prompt</h3>
                                <p className="text-sm text-zinc-400">
                                    Review the remediation prompt, then copy it to continue fixing vulnerabilities in chat.
                                </p>
                            </div>

                            <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-zinc-900 p-4 text-sm text-zinc-200">
                                {globalFixPrompt}
                            </pre>

                            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                                <button
                                    type="button"
                                    onClick={closeFixPromptModal}
                                    disabled={isCopyingFixPrompt}
                                    className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    Close
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        void handleCopyFixPrompt();
                                    }}
                                    disabled={isCopyingFixPrompt}
                                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <Copy className="w-4 h-4" />
                                    {isCopyingFixPrompt ? "Copying..." : "Copy Prompt"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeFalsePositiveView && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                        onClick={() => {
                            if (!isActiveFalsePositivePending) {
                                closeFalsePositiveModal();
                            }
                        }}
                    />
                    <div className="relative w-full max-w-2xl rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl">
                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                void handleFalsePositiveSubmit();
                            }}
                            className="space-y-5 p-6"
                        >
                            <div className="space-y-2">
                                <div className="flex items-center gap-2 text-amber-300">
                                    <ShieldAlert className="w-4 h-4" />
                                    <span className="text-xs font-semibold uppercase tracking-[0.2em]">False Positive Report</span>
                                </div>
                                <h3 className="text-xl font-semibold text-white">{activeFalsePositiveView.finding.title}</h3>
                                <p className="text-sm text-zinc-400">
                                    {activeFalsePositiveView.finding.file}
                                    {activeFalsePositiveView.finding.line ? `:${activeFalsePositiveView.finding.line}` : ""}
                                    {" • "}
                                    {activeFalsePositiveView.finding.severity.toUpperCase()}
                                </p>
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="false-positive-reason" className="text-sm font-medium text-zinc-200">
                                    Why is this a false positive?
                                </label>
                                <select
                                    id="false-positive-reason"
                                    value={falsePositiveReason}
                                    onChange={(event) => setFalsePositiveReason(event.target.value as ReportFalsePositiveReason)}
                                    className="w-full rounded-xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 focus:border-indigo-500/50 focus:outline-none"
                                >
                                    {falsePositiveReasonOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-xs text-zinc-500">
                                    {falsePositiveReasonOptions.find((option) => option.value === falsePositiveReason)?.description}
                                </p>
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="false-positive-details" className="text-sm font-medium text-zinc-200">
                                    Full details
                                </label>
                                <textarea
                                    id="false-positive-details"
                                    value={falsePositiveDetails}
                                    onChange={(event) => setFalsePositiveDetails(event.target.value)}
                                    rows={5}
                                    placeholder="Explain why this finding is incorrect, what controls already exist, and anything the reviewer should verify."
                                    className="w-full rounded-xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500/50 focus:outline-none"
                                />
                                <p className="text-xs text-zinc-500">
                                    Include enough context for review. This field is required.
                                </p>
                            </div>

                            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                                <button
                                    type="button"
                                    onClick={closeFalsePositiveModal}
                                    disabled={isActiveFalsePositivePending}
                                    className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isActiveFalsePositivePending || falsePositiveDetails.trim().length === 0}
                                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    <ShieldAlert className="w-4 h-4" />
                                    {isActiveFalsePositivePending ? "Submitting..." : "Submit False Positive"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
