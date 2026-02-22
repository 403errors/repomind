"use client";

import { useEffect, useState } from "react";
import { X, Loader2, FileCode, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { toast } from "sonner";

interface FilePreviewProps {
    isOpen: boolean;
    filePath: string | null;
    repoOwner: string;
    repoName: string;
    onClose: () => void;
}

export function FilePreview({ isOpen, filePath, repoOwner, repoName, onClose }: FilePreviewProps) {
    const [content, setContent] = useState<string>("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fileInfo, setFileInfo] = useState<{ size: number; html_url: string } | null>(null);

    const decodeBase64Content = (base64: string) => {
        const cleaned = base64.replace(/\s/g, "");
        const binary = atob(cleaned);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        return new TextDecoder("utf-8").decode(bytes);
    };

    useEffect(() => {
        if (!isOpen || !filePath) {
            setContent("");
            setLoading(false);
            setError(null);
            setFileInfo(null);
            return;
        }

        const fetchFileContent = async () => {
            setLoading(true);
            setError(null);
            setFileInfo(null);
            try {
                // Encode each segment of the path to handle spaces and special characters
                const encodedPath = filePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
                const url = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${encodedPath}`;
                console.log("Fetching file preview:", url);

                const response = await fetch(url, {
                    headers: {
                        'Accept': 'application/vnd.github.v3+json',
                    }
                });

                if (!response.ok) {
                    if (response.status === 404) throw new Error('File not found');
                    if (response.status === 403) throw new Error('Rate limit exceeded');
                    throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
                }

                const data = await response.json();
                setFileInfo({ size: data.size, html_url: data.html_url });

                // Check for binary/video/large files based on extension and size
                const ext = filePath.split('.').pop()?.toLowerCase() || '';
                const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext);
                const isVideo = ['mp4', 'mov', 'avi', 'webm', 'mkv'].includes(ext);
                const isBinary = ['pdf', 'zip', 'tar', 'gz', 'exe', 'dll', 'bin'].includes(ext);

                // 1. File > 1MB
                if (data.size > 1000000) {
                    setError('File is too large to show (>1MB)');
                    return;
                }

                // 2. Image > 500KB
                if (isImage && data.size > 500000) {
                    setError('Image is too large to show (>500KB)');
                    return;
                }

                // 3. Video or Binary
                if (isVideo || isBinary) {
                    setError('Cannot preview binary or video file');
                    return;
                }

                if (data.content) {
                    const decoded = decodeBase64Content(data.content);
                    setContent(decoded);
                } else {
                    // If content is missing but size is small (shouldn't happen for text files < 1MB usually)
                    // But if it does, it might be a submodule or something else
                    setError('No content available');
                }
            } catch (err: any) {
                const errorMessage = err.message || 'Failed to load file content';
                setError(errorMessage);
                toast.error(errorMessage);
                console.error("FilePreview Error:", err);
            } finally {
                setLoading(false);
            }
        };

        fetchFileContent();
    }, [isOpen, filePath, repoOwner, repoName]);

    if (!isOpen) return null;

    const getLanguage = (path: string) => {
        const ext = path.split('.').pop()?.toLowerCase();
        const langMap: Record<string, string> = {
            'js': 'javascript',
            'jsx': 'javascript',
            'ts': 'typescript',
            'tsx': 'typescript',
            'py': 'python',
            'rb': 'ruby',
            'go': 'go',
            'rs': 'rust',
            'java': 'java',
            'cpp': 'cpp',
            'c': 'c',
            'css': 'css',
            'html': 'html',
            'json': 'json',
            'md': 'markdown',
            'yaml': 'yaml',
            'yml': 'yaml',
            'sh': 'bash',
        };
        return langMap[ext || ''] || 'plaintext';
    };

    const isMarkdown = filePath?.endsWith('.md');
    const language = filePath ? getLanguage(filePath) : 'plaintext';

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
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
                    className="relative w-full max-w-5xl max-h-[90vh] bg-zinc-900 border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-white/10 bg-zinc-900/80 backdrop-blur-sm">
                        <div className="flex items-center gap-3">
                            <FileCode className="w-5 h-5 text-purple-400" />
                            <h2 className="text-white font-semibold truncate max-w-md" title={filePath || ''}>
                                {filePath}
                            </h2>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                        >
                            <X className="w-5 h-5 text-zinc-400 hover:text-white" />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-auto p-6 bg-zinc-950">
                        {loading && (
                            <div className="flex items-center justify-center h-full">
                                <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
                            </div>
                        )}

                        {error && (
                            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
                                <AlertCircle className="w-12 h-12 text-zinc-500" />
                                <p className="text-zinc-400 text-lg font-medium">{error}</p>
                                {fileInfo?.html_url && (
                                    <a
                                        href={fileInfo.html_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-purple-400 hover:text-purple-300 underline underline-offset-4"
                                    >
                                        View file on GitHub
                                    </a>
                                )}
                            </div>
                        )}

                        {!loading && !error && content && (
                            <>
                                {isMarkdown ? (
                                    <div className="prose prose-invert prose-sm max-w-none">
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            rehypePlugins={[rehypeRaw]}
                                        >
                                            {content}
                                        </ReactMarkdown>
                                    </div>
                                ) : (
                                    <pre className="text-sm text-zinc-300 font-mono overflow-x-auto">
                                        <code className={`language-${language}`}>
                                            {content}
                                        </code>
                                    </pre>
                                )}
                            </>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="p-3 border-t border-white/10 bg-zinc-900/80 backdrop-blur-sm flex items-center justify-between text-xs text-zinc-500">
                        <span>{content ? `${content.split('\n').length} lines` : 'N/A'}</span>
                        <span>{fileInfo?.size ? `${(fileInfo.size / 1024).toFixed(2)} KB` : '0 KB'}</span>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
