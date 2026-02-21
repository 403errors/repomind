import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Search, X, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { searchRepositoryCode } from "@/app/actions";

interface SearchModalProps {
    repoContext: { owner: string; repo: string; fileTree: any[] };
    onSendMessage: (role: "user" | "model", content: string) => void;
}

export function SearchModal({ repoContext, onSendMessage }: SearchModalProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchType, setSearchType] = useState<'text' | 'regex' | 'ast'>('text');
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!searchQuery.trim()) return;

        setLoading(true);
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
                    content += `- [${r.file}](#preview-${r.file.replace(/[^a-zA-Z0-9-]/g, '-')}) (Line ${r.line}): \`${r.content.slice(0, 100).trim()}\`\n`;
                });
                if (results.length > 30) content += `\n*...and ${results.length - 30} more.*`;
            }

            onSendMessage("model", content);
            setIsOpen(false);
        } catch (error) {
            toast.error("Search failed");
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors group relative"
                title="Search Codebase"
            >
                <Search className="w-5 h-5 group-hover:scale-110 transition-transform" />
            </button>

            {mounted && createPortal(
                <AnimatePresence>
                    {isOpen && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col"
                            >
                                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-zinc-950/50 rounded-t-2xl">
                                    <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                                        <Search className="w-5 h-5 text-purple-400" />
                                        Search Codebase
                                    </h2>
                                    <button
                                        onClick={() => !loading && setIsOpen(false)}
                                        className={`text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                                        disabled={loading}
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>

                                <div className="p-6">
                                    <form onSubmit={handleSearch} className="space-y-5">
                                        <div>
                                            <label className="block text-sm font-medium text-zinc-300 mb-2">Search Query</label>
                                            <input
                                                type="text"
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                className="w-full bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-purple-500/50 outline-none transition-shadow"
                                                placeholder="Function name, exact string, pattern..."
                                                disabled={loading}
                                                autoFocus
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-zinc-300 mb-2">Search Type</label>
                                            <div className="flex gap-2">
                                                <Tooltip text="Standard string search" className="flex-1 w-full">
                                                    <button
                                                        type="button"
                                                        onClick={() => setSearchType('text')}
                                                        disabled={loading}
                                                        className={`w-full py-2 rounded-xl text-xs font-semibold uppercase tracking-wider border transition-all ${searchType === 'text' ? 'bg-purple-500/10 border-purple-500/50 text-purple-300 shadow-sm' : 'bg-zinc-800/50 border-white/10 text-zinc-400 hover:bg-zinc-700/50'} ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                    >
                                                        Text
                                                    </button>
                                                </Tooltip>
                                                <Tooltip text="Regular expression pattern matching" className="flex-1 w-full">
                                                    <button
                                                        type="button"
                                                        onClick={() => setSearchType('regex')}
                                                        disabled={loading}
                                                        className={`w-full py-2 rounded-xl text-xs font-semibold uppercase tracking-wider border transition-all ${searchType === 'regex' ? 'bg-purple-500/10 border-purple-500/50 text-purple-300 shadow-sm' : 'bg-zinc-800/50 border-white/10 text-zinc-400 hover:bg-zinc-700/50'} ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                    >
                                                        Regex
                                                    </button>
                                                </Tooltip>
                                                <Tooltip text="Abstract Syntax Tree matching (finds code structures)" className="flex-1 w-full">
                                                    <button
                                                        type="button"
                                                        onClick={() => setSearchType('ast')}
                                                        disabled={loading}
                                                        className={`w-full py-2 rounded-xl text-xs font-semibold uppercase tracking-wider border transition-all ${searchType === 'ast' ? 'bg-purple-500/10 border-purple-500/50 text-purple-300 shadow-sm' : 'bg-zinc-800/50 border-white/10 text-zinc-400 hover:bg-zinc-700/50'} ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                    >
                                                        AST
                                                    </button>
                                                </Tooltip>
                                            </div>
                                        </div>

                                        <div className="pt-2">
                                            <button
                                                type="submit"
                                                disabled={loading || !searchQuery}
                                                className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-md"
                                            >
                                                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                                                Search Codebase
                                            </button>
                                        </div>
                                    </form>
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

function Tooltip({ children, text, className = "" }: { children: React.ReactNode; text: string; className?: string }) {
    const [isVisible, setIsVisible] = useState(false);

    return (
        <div className={`relative flex items-center justify-center ${className}`} onMouseEnter={() => setIsVisible(true)} onMouseLeave={() => setIsVisible(false)}>
            {children}
            <AnimatePresence>
                {isVisible && (
                    <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 5 }}
                        className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-max max-w-[200px] text-center px-3 py-2 bg-zinc-800 text-xs text-zinc-200 rounded-lg shadow-xl border border-white/10 z-[200] pointer-events-none font-medium"
                    >
                        {text}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-800" />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
