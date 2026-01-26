import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Wrench, Search, Shield, FileText, TestTube, Zap, X, Loader2, HelpCircle, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { searchRepositoryCode, analyzeFileQuality, generateArtifact, scanRepositoryVulnerabilities, generateSecurityPatchForFinding } from "@/app/actions";
import type { SecurityFinding } from "@/lib/security-scanner";
import { FileTreePicker } from "@/components/FileTreePicker";

interface DevToolsProps {
    repoContext: { owner: string; repo: string; fileTree: any[] };
    onSendMessage: (role: "user" | "model", content: string) => void;
}

export function DevTools({ repoContext, onSendMessage }: DevToolsProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'search' | 'quality' | 'security' | 'generate' | 'help'>('search');
    const [loadingOperation, setLoadingOperation] = useState<string | null>(null);

    // Search State
    const [searchQuery, setSearchQuery] = useState("");
    const [searchType, setSearchType] = useState<'text' | 'regex' | 'ast'>('text');

    // Quality/Gen State
    const [selectedFile, setSelectedFile] = useState("");

    // Security State
    const [securityDepth, setSecurityDepth] = useState<'quick' | 'deep'>('quick');
    const [securityEnableAi, setSecurityEnableAi] = useState(true);
    const [showFilePicker, setShowFilePicker] = useState(false);
    const [securitySelectedFiles, setSecuritySelectedFiles] = useState<string[]>([]);
    const [securityReport, setSecurityReport] = useState<{
        findings: SecurityFinding[];
        summary: any;
        meta: any;
    } | null>(null);
    const [patches, setPatches] = useState<Record<string, { patch: string; explanation: string }>>({});
    const [patchLoadingId, setPatchLoadingId] = useState<string | null>(null);

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!searchQuery.trim()) return;

        setLoadingOperation('search');
        try {
            const filePaths = repoContext.fileTree.map((f: any) => f.path);
            const results = await searchRepositoryCode(
                repoContext.owner,
                repoContext.repo,
                filePaths,
                searchQuery,
                searchType
            );

            let content = `### 🔍 Search Results for "${searchQuery}" (${searchType})\n\n`;
            if (results.length === 0) {
                content += "No matches found.";
            } else {
                content += `Found **${results.length}** matches:\n\n`;
                results.slice(0, 30).forEach(r => {
                    content += `- [${r.file}](#preview-${r.file}) (Line ${r.line}): \`${r.content.slice(0, 100).trim()}\`\n`;
                });
                if (results.length > 30) content += `\n*...and ${results.length - 30} more.*`;
            }

            onSendMessage("model", content);
            setIsOpen(false);
        } catch (error) {
            toast.error("Search failed");
        } finally {
            setLoadingOperation(null);
        }
    };

    const handleQualityAnalysis = async () => {
        if (!selectedFile) {
            toast.error("Please select a file");
            return;
        }

        setLoadingOperation('quality');
        try {
            const report = await analyzeFileQuality(repoContext.owner, repoContext.repo, selectedFile);

            if (!report) {
                throw new Error("Analysis failed");
            }

            let content = `### 🛡️ Quality Report: ${selectedFile}\n\n`;
            content += `**Score**: ${report.score}/100\n\n`;
            content += `**Complexity**: ${report.metrics.complexity}\n\n`;
            content += `**Summary**: ${report.summary}\n\n`;

            if (report.issues.length > 0) {
                content += `**Issues**:\n`;
                report.issues.forEach(issue => {
                    content += `- [${issue.severity.toUpperCase()}] Line ${issue.line}: ${issue.message}\n`;
                });
            } else {
                content += "✅ No significant issues found.";
            }

            onSendMessage("model", content);
            setIsOpen(false);
        } catch (error: any) {
            if (error.message?.includes("File is too large") || error.toString().includes("File is too large")) {
                toast.error("File is too large (over 5000 words)");
            } else {
                toast.error("Analysis failed");
            }
        } finally {
            setLoadingOperation(null);
        }
    };

    const handleGenerate = async (type: 'doc' | 'test' | 'refactor') => {
        if (!selectedFile) {
            toast.error("Please select a file");
            return;
        }

        setLoadingOperation(type);
        try {
            const artifact = await generateArtifact(repoContext.owner, repoContext.repo, selectedFile, type);

            if (artifact.startsWith("Error: File is too large")) {
                throw new Error("File is too large");
            }

            let title = "";
            switch (type) {
                case 'doc': title = "📝 Generated Documentation"; break;
                case 'test': title = "🧪 Generated Tests"; break;
                case 'refactor': title = "✨ Refactoring Suggestions"; break;
            }

            let content = "";
            if (type === 'refactor') {
                content = `### ${title} for \`${selectedFile}\`\n\n${artifact}`;
            } else {
                content = `### ${title} for \`${selectedFile}\`\n\n\`\`\`typescript\n${artifact}\n\`\`\``;
            }
            onSendMessage("model", content);
            setIsOpen(false);
        } catch (error: any) {
            if (error.message?.includes("File is too large")) {
                toast.error("File is too large (over 5000 words)");
            } else {
                toast.error("Generation failed");
            }
        } finally {
            setLoadingOperation(null);
        }
    };

    const handleSecurityScan = async () => {
        setLoadingOperation('security');
        setSecurityReport(null);
        setPatches({});
        try {
            const filesToScan = repoContext.fileTree.map((f: any) => ({ path: f.path, sha: f.sha }));

            const { findings, summary, meta } = await scanRepositoryVulnerabilities(
                repoContext.owner,
                repoContext.repo,
                filesToScan,
                {
                    depth: securityDepth,
                    enableAi: securityEnableAi,
                    filePaths: securitySelectedFiles.length > 0 ? securitySelectedFiles : undefined
                }
            );

            const filesScanned = summary.debug?.filesSuccessfullyFetched || 0;
            let content = `### 🛡️ Security Report\n\n`;
            content += `**Depth**: ${meta.depth}  \n`;
            content += `**AI Analysis**: ${meta.aiEnabled ? `Enabled (${meta.aiFilesSelected} files)` : 'Disabled'}  \n`;
            content += `**Files Scanned**: ${filesScanned}  \n`;
            content += `**Duration**: ${(meta.durationMs / 1000).toFixed(1)}s\n\n`;

            if (summary.total === 0) {
                content += `✅ No security issues found in the scanned files.\n\n`;
                content += `This scan checked for:\n- Secrets in source code\n- Common injection patterns\n- Unsafe crypto usage\n- Dependency risks\n\n`;
            } else {
                content += `**Findings**: ${summary.total}  \n`;
                if (summary.critical > 0) content += `🔴 Critical: ${summary.critical}  \n`;
                if (summary.high > 0) content += `🟠 High: ${summary.high}  \n`;
                if (summary.medium > 0) content += `🟡 Medium: ${summary.medium}  \n`;
                if (summary.low > 0) content += `🔵 Low: ${summary.low}  \n`;
                if (summary.info > 0) content += `⚪ Info: ${summary.info}  \n`;
                content += `\n`;

                content += `View full findings in Dev Tools → Security.\n`;
            }

            onSendMessage("model", content);
            setSecurityReport({ findings, summary, meta });
            setShowFilePicker(false);
        } catch (error: any) {
            if (error?.message) {
                toast.error("Security scan failed", { description: error.message });
            } else {
                toast.error("Security scan failed");
            }
        } finally {
            setLoadingOperation(null);
        }
    };

    const handleGeneratePatch = async (finding: SecurityFinding) => {
        const id = `${finding.file}:${finding.line || 0}:${finding.title}`;
        setPatchLoadingId(id);
        try {
            const result = await generateSecurityPatchForFinding(
                repoContext.owner,
                repoContext.repo,
                finding
            );
            setPatches((prev) => ({ ...prev, [id]: result }));
        } catch (error) {
            toast.error("Patch generation failed");
        } finally {
            setPatchLoadingId(null);
        }
    };

    const handleCopy = async (text: string, successMessage: string) => {
        try {
            await navigator.clipboard.writeText(text);
            toast.success(successMessage);
        } catch {
            toast.error("Copy failed");
        }
    };

    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
                title="Dev Tools"
            >
                <Wrench className="w-5 h-5" />
            </button>

            {mounted && createPortal(
                <AnimatePresence>
                    {isOpen && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl"
                            >
                                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-zinc-950/50 rounded-t-2xl">
                                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                                        <Wrench className="w-5 h-5 text-purple-400" />
                                        Dev Tools
                                    </h2>
                                    <button
                                        onClick={() => !loadingOperation && setIsOpen(false)}
                                        className={`text-zinc-400 hover:text-white ${loadingOperation ? 'opacity-50 cursor-not-allowed' : ''}`}
                                        disabled={!!loadingOperation}
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>

                                <div className="flex border-b border-white/10">
                                    <button
                                        onClick={() => setActiveTab('search')}
                                        disabled={!!loadingOperation}
                                        className={`flex-1 p-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${activeTab === 'search' ? 'text-purple-400 border-b-2 border-purple-400 bg-purple-400/5' : 'text-zinc-400 hover:text-zinc-200'} ${loadingOperation ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                        <Search className="w-4 h-4" /> Search
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('quality')}
                                        disabled={!!loadingOperation}
                                        className={`flex-1 p-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${activeTab === 'quality' ? 'text-purple-400 border-b-2 border-purple-400 bg-purple-400/5' : 'text-zinc-400 hover:text-zinc-200'} ${loadingOperation ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                        <Shield className="w-4 h-4" /> Quality
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('generate')}
                                        disabled={!!loadingOperation}
                                        className={`flex-1 p-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${activeTab === 'generate' ? 'text-purple-400 border-b-2 border-purple-400 bg-purple-400/5' : 'text-zinc-400 hover:text-zinc-200'} ${loadingOperation ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                        <Zap className="w-4 h-4" /> Generate
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('security')}
                                        disabled={!!loadingOperation}
                                        className={`flex-1 p-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${activeTab === 'security' ? 'text-purple-400 border-b-2 border-purple-400 bg-purple-400/5' : 'text-zinc-400 hover:text-zinc-200'} ${loadingOperation ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                        <AlertTriangle className="w-4 h-4" /> Security
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('help')}
                                        disabled={!!loadingOperation}
                                        className={`flex-1 p-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${activeTab === 'help' ? 'text-purple-400 border-b-2 border-purple-400 bg-purple-400/5' : 'text-zinc-400 hover:text-zinc-200'} ${loadingOperation ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                        <HelpCircle className="w-4 h-4" /> Help
                                    </button>
                                </div>

                                <div className="p-6 min-h-[300px]">
                                    {activeTab === 'search' && (
                                        <form onSubmit={handleSearch} className="space-y-4">
                                            <div>
                                                <label className="block text-xs font-medium text-zinc-400 mb-1">Search Query</label>
                                                <input
                                                    type="text"
                                                    value={searchQuery}
                                                    onChange={(e) => setSearchQuery(e.target.value)}
                                                    className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500/50 outline-none"
                                                    placeholder="Function name, regex pattern..."
                                                    disabled={!!loadingOperation}
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-zinc-400 mb-1">Search Type</label>
                                                <div className="flex gap-2">
                                                    <Tooltip text="Standard string search">
                                                        <button
                                                            type="button"
                                                            onClick={() => setSearchType('text')}
                                                            disabled={!!loadingOperation}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${searchType === 'text' ? 'bg-purple-500/20 border-purple-500 text-purple-300' : 'bg-zinc-800 border-white/10 text-zinc-400 hover:bg-zinc-700'} ${loadingOperation ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                        >
                                                            TEXT
                                                        </button>
                                                    </Tooltip>
                                                    <Tooltip text="Regular expression pattern matching">
                                                        <button
                                                            type="button"
                                                            onClick={() => setSearchType('regex')}
                                                            disabled={!!loadingOperation}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${searchType === 'regex' ? 'bg-purple-500/20 border-purple-500 text-purple-300' : 'bg-zinc-800 border-white/10 text-zinc-400 hover:bg-zinc-700'} ${loadingOperation ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                        >
                                                            REGEX
                                                        </button>
                                                    </Tooltip>
                                                    <Tooltip text="Abstract Syntax Tree search (finds code structures)">
                                                        <button
                                                            type="button"
                                                            onClick={() => setSearchType('ast')}
                                                            disabled={!!loadingOperation}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${searchType === 'ast' ? 'bg-purple-500/20 border-purple-500 text-purple-300' : 'bg-zinc-800 border-white/10 text-zinc-400 hover:bg-zinc-700'} ${loadingOperation ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                        >
                                                            AST
                                                        </button>
                                                    </Tooltip>
                                                </div>
                                            </div>
                                            <button
                                                type="submit"
                                                disabled={!!loadingOperation || !searchQuery}
                                                className="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                            >
                                                {loadingOperation === 'search' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                                                Run Search
                                            </button>
                                        </form>
                                    )}

                                    {(activeTab === 'quality' || activeTab === 'generate') && (
                                        <div className="space-y-4">
                                            <div>
                                                <label className="block text-xs font-medium text-zinc-400 mb-1">Select File</label>
                                                <select
                                                    value={selectedFile}
                                                    onChange={(e) => setSelectedFile(e.target.value)}
                                                    disabled={!!loadingOperation}
                                                    className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-purple-500/50 outline-none appearance-none disabled:opacity-50"
                                                >
                                                    <option value="">-- Choose a file --</option>
                                                    {repoContext.fileTree
                                                        .filter((f: any) => /\.(js|jsx|ts|tsx|py|go|rs|java)$/.test(f.path))
                                                        .map((f: any) => (
                                                            <option key={f.path} value={f.path}>{f.path}</option>
                                                        ))}
                                                </select>
                                            </div>

                                            {activeTab === 'quality' && (
                                                <button
                                                    onClick={handleQualityAnalysis}
                                                    disabled={!!loadingOperation || !selectedFile}
                                                    className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                                >
                                                    {loadingOperation === 'quality' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                                                    Analyze Quality
                                                </button>
                                            )}

                                            {activeTab === 'generate' && (
                                                <div className="grid grid-cols-1 gap-2">
                                                    <button
                                                        onClick={() => handleGenerate('doc')}
                                                        disabled={!!loadingOperation || !selectedFile}
                                                        className="p-3 bg-zinc-800 hover:bg-zinc-700 border border-white/10 rounded-lg text-left flex items-center gap-3 transition-colors disabled:opacity-50"
                                                    >
                                                        {loadingOperation === 'doc' ? <Loader2 className="w-5 h-5 animate-spin text-zinc-400" /> : <FileText className="w-5 h-5 text-green-400" />}
                                                        <div>
                                                            <div className="text-sm font-medium text-white">Generate Documentation</div>
                                                            <div className="text-xs text-zinc-500">JSDoc/TSDoc comments</div>
                                                        </div>
                                                    </button>
                                                    <button
                                                        onClick={() => handleGenerate('test')}
                                                        disabled={!!loadingOperation || !selectedFile}
                                                        className="p-3 bg-zinc-800 hover:bg-zinc-700 border border-white/10 rounded-lg text-left flex items-center gap-3 transition-colors disabled:opacity-50"
                                                    >
                                                        {loadingOperation === 'test' ? <Loader2 className="w-5 h-5 animate-spin text-zinc-400" /> : <TestTube className="w-5 h-5 text-blue-400" />}
                                                        <div>
                                                            <div className="text-sm font-medium text-white">Generate Unit Tests</div>
                                                            <div className="text-xs text-zinc-500">Jest/Vitest templates</div>
                                                        </div>
                                                    </button>
                                                    <button
                                                        onClick={() => handleGenerate('refactor')}
                                                        disabled={!!loadingOperation || !selectedFile}
                                                        className="p-3 bg-zinc-800 hover:bg-zinc-700 border border-white/10 rounded-lg text-left flex items-center gap-3 transition-colors disabled:opacity-50"
                                                    >
                                                        {loadingOperation === 'refactor' ? <Loader2 className="w-5 h-5 animate-spin text-zinc-400" /> : <Zap className="w-5 h-5 text-yellow-400" />}
                                                        <div>
                                                            <div className="text-sm font-medium text-white">Suggest Refactoring</div>
                                                            <div className="text-xs text-zinc-500">Improve code quality</div>
                                                        </div>
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {activeTab === 'security' && (
                                        <div className="space-y-4">
                                            <div>
                                                <label className="block text-xs font-medium text-zinc-400 mb-1">Scan Depth</label>
                                                <div className="flex gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setSecurityDepth('quick')}
                                                        disabled={!!loadingOperation}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${securityDepth === 'quick' ? 'bg-purple-500/20 border-purple-500 text-purple-300' : 'bg-zinc-800 border-white/10 text-zinc-400 hover:bg-zinc-700'} ${loadingOperation ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                    >
                                                        QUICK
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setSecurityDepth('deep')}
                                                        disabled={!!loadingOperation}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${securityDepth === 'deep' ? 'bg-purple-500/20 border-purple-500 text-purple-300' : 'bg-zinc-800 border-white/10 text-zinc-400 hover:bg-zinc-700'} ${loadingOperation ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                    >
                                                        DEEP
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <div className="text-sm text-zinc-400">File Scope</div>
                                                <button
                                                    type="button"
                                                    onClick={() => setShowFilePicker((prev) => !prev)}
                                                    disabled={!!loadingOperation}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${showFilePicker ? 'bg-purple-500/20 border-purple-500 text-purple-300' : 'bg-zinc-800 border-white/10 text-zinc-400 hover:bg-zinc-700'} ${loadingOperation ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                >
                                                    {showFilePicker ? 'HIDE' : 'SELECT FILES'}
                                                </button>
                                            </div>
                                            {showFilePicker && (
                                                <FileTreePicker
                                                    files={repoContext.fileTree.filter((f: any) => /\.(js|jsx|ts|tsx|py|java|php|rb|go|rs|json)$/.test(f.path))}
                                                    selected={securitySelectedFiles}
                                                    onChange={setSecuritySelectedFiles}
                                                />
                                            )}
                                            {!showFilePicker && (
                                                <div className="text-xs text-zinc-500">
                                                    {securitySelectedFiles.length > 0
                                                        ? `${securitySelectedFiles.length} files selected`
                                                        : 'All code files will be scanned.'}
                                                </div>
                                            )}
                                            <div className="flex items-center justify-between">
                                                <div className="text-sm text-zinc-400">AI Analysis</div>
                                                <button
                                                    type="button"
                                                    onClick={() => setSecurityEnableAi((prev) => !prev)}
                                                    disabled={!!loadingOperation}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${securityEnableAi ? 'bg-purple-500/20 border-purple-500 text-purple-300' : 'bg-zinc-800 border-white/10 text-zinc-400 hover:bg-zinc-700'} ${loadingOperation ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                >
                                                    {securityEnableAi ? 'ENABLED' : 'DISABLED'}
                                                </button>
                                            </div>
                                            <button
                                                onClick={handleSecurityScan}
                                                disabled={!!loadingOperation}
                                                className="w-full py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                            >
                                                {loadingOperation === 'security' ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                                                Run Security Scan
                                            </button>

                                            {securityReport && (
                                                <div className="pt-4 border-t border-white/10 space-y-4">
                                                    <div>
                                                        <div className="text-sm font-semibold text-white">Report Summary</div>
                                                        <div className="text-xs text-zinc-400 mt-1">
                                                            {securityReport.summary.total} issues • {securityReport.meta.depth} scan • {securityReport.meta.aiEnabled ? `AI on (${securityReport.meta.aiFilesSelected} files)` : 'AI off'}
                                                        </div>
                                                    </div>
                                                    <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                                                        {securityReport.findings.length === 0 && (
                                                            <div className="text-xs text-zinc-400">No issues found.</div>
                                                        )}
                                                        {securityReport.findings.map((finding) => {
                                                            const id = `${finding.file}:${finding.line || 0}:${finding.title}`;
                                                            const patch = patches[id];
                                                            const isLoadingPatch = patchLoadingId === id;
                                                            return (
                                                                <div key={id} className="bg-zinc-950/60 border border-white/10 rounded-lg p-3 space-y-2">
                                                                    <div className="flex items-start justify-between gap-2">
                                                                        <div>
                                                                            <div className="text-sm text-white font-medium">{finding.title}</div>
                                                                            <div className="text-xs text-zinc-400">
                                                                                {finding.severity.toUpperCase()} • {finding.file}{finding.line ? `:${finding.line}` : ''}
                                                                            </div>
                                                                        </div>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleGeneratePatch(finding)}
                                                                            disabled={isLoadingPatch || !!loadingOperation}
                                                                            className="px-2 py-1 rounded bg-zinc-800 border border-white/10 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
                                                                        >
                                                                            {isLoadingPatch ? 'Generating...' : 'Generate Patch'}
                                                                        </button>
                                                                    </div>
                                                                    <div className="text-xs text-zinc-300">{finding.description}</div>
                                                                    {finding.snippet && (
                                                                        <pre className="text-[11px] bg-black/40 border border-white/10 rounded p-2 overflow-x-auto text-zinc-300">
                                                                            {finding.snippet}
                                                                        </pre>
                                                                    )}
                                                                    <div className="text-xs text-zinc-400">Fix: {finding.recommendation}</div>
                                                                    {patch && (
                                                                        <div className="space-y-2">
                                                                            <div className="text-xs text-zinc-400">{patch.explanation}</div>
                                                                            {patch.patch && (
                                                                                <div className="space-y-2">
                                                                                    <div className="flex flex-wrap gap-2">
                                                                                        <button
                                                                                            type="button"
                                                                                            onClick={() => handleCopy(patch.patch, "Patch copied")}
                                                                                            className="px-2 py-1 rounded bg-zinc-800 border border-white/10 text-[11px] text-zinc-200 hover:bg-zinc-700"
                                                                                        >
                                                                                            Copy Patch
                                                                                        </button>
                                                                                    </div>
                                                                                    <pre className="text-[11px] bg-black/50 border border-white/10 rounded p-2 overflow-x-auto text-zinc-300">
                                                                                        {patch.patch}
                                                                                    </pre>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {activeTab === 'help' && (
                                        <div className="space-y-6 text-sm text-zinc-300">
                                            <div className="space-y-2">
                                                <h3 className="font-semibold text-white flex items-center gap-2">
                                                    <Search className="w-4 h-4 text-purple-400" />
                                                    How to Use Advanced Search
                                                </h3>
                                                <ol className="list-decimal list-inside space-y-1 text-zinc-400 ml-1">
                                                    <li>Open a repo and click the <Wrench className="w-3 h-3 inline mx-1" /> Wrench icon.</li>
                                                    <li>Select the <strong>Search</strong> tab.</li>
                                                    <li>Type <code className="bg-zinc-800 px-1 rounded text-xs">ChatInterface</code> and select <strong>AST</strong>.</li>
                                                    <li>See it find the component definition instantly.</li>
                                                </ol>
                                            </div>

                                            <div className="space-y-2">
                                                <h3 className="font-semibold text-white flex items-center gap-2">
                                                    <Shield className="w-4 h-4 text-blue-400" />
                                                    How to Analyze Quality
                                                </h3>
                                                <ol className="list-decimal list-inside space-y-1 text-zinc-400 ml-1">
                                                    <li>Click <Wrench className="w-3 h-3 inline mx-1" /> <strong>Quality</strong>.</li>
                                                    <li>Select a file (e.g., <code className="bg-zinc-800 px-1 rounded text-xs">src/lib/github.ts</code>).</li>
                                                    <li>Click <strong>Analyze Quality</strong>.</li>
                                                    <li>Review the complexity score and AI feedback in the chat.</li>
                                                </ol>
                                            </div>

                                            <div className="space-y-2">
                                                <h3 className="font-semibold text-white flex items-center gap-2">
                                                    <TestTube className="w-4 h-4 text-green-400" />
                                                    How to Generate Tests
                                                </h3>
                                                <ol className="list-decimal list-inside space-y-1 text-zinc-400 ml-1">
                                                    <li>Click <Wrench className="w-3 h-3 inline mx-1" /> <strong>Generate</strong>.</li>
                                                    <li>Select a file.</li>
                                                    <li>Click <strong>Generate Unit Tests</strong>.</li>
                                                    <li>Copy the generated Jest code block.</li>
                                                </ol>
                                            </div>
                                            <div className="space-y-2">
                                                <h3 className="font-semibold text-white flex items-center gap-2">
                                                    <AlertTriangle className="w-4 h-4 text-red-400" />
                                                    How to Run a Security Scan
                                                </h3>
                                                <ol className="list-decimal list-inside space-y-1 text-zinc-400 ml-1">
                                                    <li>Click <Wrench className="w-3 h-3 inline mx-1" /> <strong>Security</strong>.</li>
                                                    <li>Pick depth and optional include/exclude patterns.</li>
                                                    <li>Click <strong>Run Security Scan</strong>.</li>
                                                    <li>Review the report in chat.</li>
                                                </ol>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>,
                document.body
            )}
        </>
    );
}

function Tooltip({ children, text }: { children: React.ReactNode; text: string }) {
    const [isVisible, setIsVisible] = useState(false);

    return (
        <div className="relative flex items-center" onMouseEnter={() => setIsVisible(true)} onMouseLeave={() => setIsVisible(false)}>
            {children}
            <AnimatePresence>
                {isVisible && (
                    <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 5 }}
                        className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-zinc-800 text-xs text-white rounded shadow-lg whitespace-nowrap border border-white/10 z-50 pointer-events-none"
                    >
                        {text}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-800" />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
