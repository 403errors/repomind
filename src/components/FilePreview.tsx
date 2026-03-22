"use client";

import { useEffect, useState } from "react";
import { X, Loader2, AlertCircle, ExternalLink, Download, FileText, FileVideo, FileAudio, FileImage as FileImageIcon } from "lucide-react";
import { FileIcon } from "./FileIcon";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { toast } from "sonner";

function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

interface FilePreviewProps {
    isOpen: boolean;
    filePath: string | null;
    repoOwner: string;
    repoName: string;
    onClose: () => void;
}

type FileType = 'text' | 'markdown' | 'image' | 'video' | 'audio' | 'pdf' | 'binary' | 'unknown';

export function FilePreview({ isOpen, filePath, repoOwner, repoName, onClose }: FilePreviewProps) {
    const [content, setContent] = useState<string>("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fileInfo, setFileInfo] = useState<{ size: number; html_url: string; download_url?: string } | null>(null);
    const [fileType, setFileType] = useState<FileType>('unknown');

    const decodeBase64Content = (base64: string) => {
        try {
            const cleaned = base64.replace(/\s/g, "");
            const binary = atob(cleaned);
            const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
            return new TextDecoder("utf-8").decode(bytes);
        } catch (e) {
            console.error("Decoding error:", e);
            return "Error decoding content. This might be a binary file.";
        }
    };

    const getFileType = (path: string): FileType => {
        const ext = path.split('.').pop()?.toLowerCase() || '';
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'avif'].includes(ext)) return 'image';
        if (['mp4', 'mov', 'avi', 'webm', 'mkv', 'ogv'].includes(ext)) return 'video';
        if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext)) return 'audio';
        if (ext === 'pdf') return 'pdf';
        if (['md', 'markdown'].includes(ext)) return 'markdown';
        if (['zip', 'tar', 'gz', '7z', 'rar', 'exe', 'dll', 'bin', 'so', 'dmg', 'iso'].includes(ext)) return 'binary';
        
        // Default to text if it's a known code extension or no extension
        const textExts = ['js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'cpp', 'c', 'h', 'hpp', 'css', 'scss', 'html', 'json', 'yaml', 'yml', 'sh', 'bash', 'txt', 'log', 'env', 'gitignore', 'editorconfig', 'dockerfile', 'toml', 'xml', 'sql'];
        if (textExts.includes(ext) || !ext) return 'text';
        
        return 'unknown';
    };

    useEffect(() => {
        if (!isOpen || !filePath) {
            setContent("");
            setLoading(false);
            setError(null);
            setFileInfo(null);
            setFileType('unknown');
            return;
        }

        const fetchFileContent = async () => {
            setLoading(true);
            setError(null);
            setFileInfo(null);
            try {
                const type = getFileType(filePath);
                setFileType(type);

                const encodedPath = filePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
                const url = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${encodedPath}`;
                
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
                setFileInfo({ 
                    size: data.size, 
                    html_url: data.html_url, 
                    download_url: data.download_url 
                });

                // For text-based files, we fetch the content from the API (which is base64)
                if (type === 'text' || type === 'markdown') {
                    if (data.size > 1000000) {
                        setError('File is too large to preview (>1MB)');
                        return;
                    }

                    if (data.content) {
                        const decoded = decodeBase64Content(data.content);
                        setContent(decoded);
                    } else if (data.download_url) {
                        // Sometimes the content is not in the JSON for larger files or specific types
                        const textRes = await fetch(data.download_url);
                        const text = await textRes.text();
                        setContent(text);
                    } else {
                        setError('No content available');
                    }
                } else if (type === 'binary') {
                    setError('Cannot preview binary file');
                } else if (type === 'unknown' && data.size > 500000) {
                    setError('File is large and format is unknown');
                }
                
                // For media, we don't need to fetch 'content', we'll use download_url in the render
            } catch (err: unknown) {
                const errorMessage = getErrorMessage(err, 'Failed to load file content');
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

    const language = filePath ? getLanguage(filePath) : 'plaintext';

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-black/80 backdrop-blur-sm"
                    onClick={onClose}
                />

                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    className="relative w-full max-w-5xl max-h-[90vh] bg-zinc-900 border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden"
                >
                    {/* Header */}
                    <div className="flex items-center justify-between gap-4 p-4 border-b border-white/10 bg-zinc-900/80 backdrop-blur-sm">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                            <FileIcon filename={filePath?.split('/').pop() || ''} className="w-5 h-5 flex-shrink-0" />
                            <h2 className="text-white font-semibold truncate" title={filePath || ''}>
                                {filePath}
                            </h2>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            {fileInfo?.download_url && (
                                <a
                                    href={fileInfo.download_url}
                                    download
                                    className="p-2 hover:bg-white/10 rounded-lg transition-colors text-zinc-400 hover:text-white"
                                    title="Download File"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <Download className="w-4 h-4" />
                                </a>
                            )}
                            {fileInfo?.html_url && (
                                <a
                                    href={fileInfo.html_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-2 hover:bg-white/10 rounded-lg transition-colors text-zinc-400 hover:text-white"
                                    title="View on GitHub"
                                >
                                    <ExternalLink className="w-4 h-4" />
                                </a>
                            )}
                            <button
                                onClick={onClose}
                                className="p-2 hover:bg-white/10 rounded-lg transition-colors ms-2"
                            >
                                <X className="w-5 h-5 text-zinc-400 hover:text-white" />
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-auto bg-zinc-950 flex flex-col min-h-0">
                        {loading && (
                            <div className="flex flex-col items-center justify-center flex-1 py-20">
                                <Loader2 className="w-10 h-10 text-purple-400 animate-spin" />
                                <p className="mt-4 text-zinc-400 animate-pulse">Fetching content...</p>
                            </div>
                        )}

                        {error && !loading && (
                            <div className="flex flex-col items-center justify-center flex-1 p-10 text-center gap-4">
                                <AlertCircle className="w-16 h-16 text-zinc-700" />
                                <div>
                                    <h3 className="text-white text-xl font-medium mb-2">{error}</h3>
                                    <p className="text-zinc-500 max-w-md">
                                        We couldn't render this file directly. You can try viewing it on GitHub or downloading it.
                                    </p>
                                </div>
                                <div className="flex gap-3 mt-4">
                                    {fileInfo?.html_url && (
                                        <a
                                            href={fileInfo.html_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-white transition-colors flex items-center gap-2"
                                        >
                                            <ExternalLink className="w-4 h-4" />
                                            View on GitHub
                                        </a>
                                    )}
                                </div>
                            </div>
                        )}

                        {!loading && !error && (
                            <div className="flex-1 overflow-auto p-4 md:p-6">
                                {fileType === 'image' && fileInfo?.download_url && (
                                    <div className="flex items-center justify-center h-full min-h-[300px] p-4 bg-zinc-900/50 rounded-lg border border-white/5">
                                        <img 
                                            src={fileInfo.download_url} 
                                            alt={filePath || ''} 
                                            className="max-w-full max-h-full object-contain rounded-sm shadow-xl"
                                            onError={() => setError("Failed to load image")}
                                        />
                                    </div>
                                )}

                                {fileType === 'video' && fileInfo?.download_url && (
                                    <div className="flex items-center justify-center h-full min-h-[300px]">
                                        <video 
                                            controls 
                                            className="max-w-full max-h-[70vh] rounded-lg shadow-2xl"
                                            poster=""
                                        >
                                            <source src={fileInfo.download_url} />
                                            Your browser does not support the video tag.
                                        </video>
                                    </div>
                                )}

                                {fileType === 'audio' && fileInfo?.download_url && (
                                    <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-6 p-10 bg-zinc-900/50 rounded-lg border border-white/5">
                                        <div className="w-20 h-20 rounded-full bg-purple-500/20 flex items-center justify-center">
                                            <FileAudio className="w-10 h-10 text-purple-400" />
                                        </div>
                                        <audio controls className="w-full max-w-md">
                                            <source src={fileInfo.download_url} />
                                            Your browser does not support the audio tag.
                                        </audio>
                                    </div>
                                )}

                                {fileType === 'pdf' && fileInfo?.download_url && (
                                    <div className="h-full min-h-[60vh] w-full rounded-lg overflow-hidden border border-white/10 shadow-2xl bg-white">
                                        <iframe 
                                            src={`https://docs.google.com/viewer?url=${encodeURIComponent(fileInfo.download_url)}&embedded=true`}
                                            className="w-full h-full border-none"
                                            title="PDF Preview"
                                        />
                                    </div>
                                )}

                                {fileType === 'markdown' && content && (
                                    <div className="prose prose-invert prose-sm max-w-none">
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            rehypePlugins={[rehypeRaw, rehypeSanitize]}
                                            components={{
                                                img: ({ ...props }) => {
                                                    const src = (props.src as string) || '';
                                                    const isRelative = !src.startsWith('http') && !src.startsWith('https') && !src.startsWith('data:');
                                                    
                                                    if (isRelative && fileInfo?.download_url) {
                                                        // Resolve relative path by finding the directory of the current file
                                                        // Example: download_url is '.../docs/readme.md', baseUrl becomes '.../docs'
                                                        const baseUrl = fileInfo.download_url.split('/').slice(0, -1).join('/');
                                                        const resolvedSrc = `${baseUrl}/${src.startsWith('./') ? src.substring(2) : src}`;
                                                        return <img {...props} src={resolvedSrc} className="rounded-lg shadow-md max-w-full my-4" />;
                                                    }
                                                    return <img {...props} className="rounded-lg shadow-md max-w-full my-4" />;
                                                }
                                            }}
                                        >
                                            {content}
                                        </ReactMarkdown>
                                    </div>
                                )}

                                {(fileType === 'text' || (fileType === 'unknown' && content)) && (
                                    <pre className="text-sm text-zinc-300 font-mono overflow-x-auto p-4 bg-zinc-900/50 rounded-lg border border-white/5">
                                        <code className={`language-${language}`}>
                                            {content}
                                        </code>
                                    </pre>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="p-3 border-t border-white/10 bg-zinc-900/80 backdrop-blur-sm flex items-center justify-between text-xs text-zinc-500">
                        <div className="flex items-center gap-4">
                            <span>{fileType.toUpperCase()} FILE</span>
                            {content && <span>{content.split('\n').length} lines</span>}
                        </div>
                        <span>{fileInfo?.size ? `${(fileInfo.size / 1024).toFixed(2)} KB` : '0 KB'}</span>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
