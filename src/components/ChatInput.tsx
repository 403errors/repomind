import { useRef, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Send, Zap, Brain, ChevronDown, Network, FileCode, X, Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import type { ModelPreference } from "@/lib/ai-client";

interface ChatInputProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (e: React.FormEvent) => void;
    placeholder?: string;
    disabled?: boolean;
    loading?: boolean;
    allowEmptySubmit?: boolean;
    modelPreference?: ModelPreference;
    setModelPreference?: (pref: ModelPreference) => void;
    onRequireAuth?: () => void;
    showCrossRepoToggle?: boolean;
    crossRepoEnabled?: boolean;
    setCrossRepoEnabled?: (enabled: boolean) => void;
    onRequireCrossRepoAuth?: () => void;
    repositoryFiles?: { path: string; type?: "blob" | "tree" }[];
    taggedFiles?: string[];
    onTaggedFilesChange?: (files: string[]) => void;
}

export function ChatInput({
    value,
    onChange,
    onSubmit,
    placeholder,
    disabled,
    loading,
    allowEmptySubmit,
    modelPreference = "flash",
    setModelPreference,
    onRequireAuth,
    showCrossRepoToggle = false,
    crossRepoEnabled = false,
    setCrossRepoEnabled,
    onRequireCrossRepoAuth,
    repositoryFiles = [],
    taggedFiles = [],
    onTaggedFilesChange,
}: ChatInputProps) {
    const { data: session } = useSession();
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [isMobile, setIsMobile] = useState(false);
    const [showModelDropdown, setShowModelDropdown] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Tagging state
    const [showMentionMenu, setShowMentionMenu] = useState(false);
    const [mentionQuery, setMentionQuery] = useState("");
    const [mentionIndex, setMentionIndex] = useState(0);
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.matchMedia('(pointer: coarse)').matches);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);

        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setShowModelDropdown(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);

        return () => {
            window.removeEventListener('resize', checkMobile);
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    const adjustHeight = () => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            const newHeight = Math.min(textarea.scrollHeight, 200);
            textarea.style.height = `${newHeight}px`;

            if (textarea.scrollHeight > 200) {
                textarea.style.overflowY = 'auto';
            } else {
                textarea.style.overflowY = 'hidden';
            }
        }
    };

    useEffect(() => {
        adjustHeight();
    }, [value]);

    const filteredFiles = repositoryFiles
        .filter(f => f.path.toLowerCase().includes(mentionQuery.toLowerCase()) && !taggedFiles.includes(f.path))
        .slice(0, 10);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (showMentionMenu) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setMentionIndex(prev => (prev < filteredFiles.length - 1 ? prev + 1 : prev));
                return;
            }
            if (e.key === "ArrowUp") {
                e.preventDefault();
                setMentionIndex(prev => (prev > 0 ? prev - 1 : prev));
                return;
            }
            if (e.key === "Enter") {
                e.preventDefault();
                if (filteredFiles[mentionIndex]) {
                    addTag(filteredFiles[mentionIndex].path);
                }
                return;
            }
            if (e.key === "Escape") {
                setShowMentionMenu(false);
                return;
            }
        }

        if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
            e.preventDefault();
            if (!value.trim() && !allowEmptySubmit && taggedFiles.length === 0) return;
            onSubmit(e);
        }
    };

    const handleChange = (newVal: string) => {
        onChange(newVal);
        const cursor = textareaRef.current?.selectionStart || 0;
        const textBeforeCursor = newVal.slice(0, cursor);
        const match = textBeforeCursor.match(/@([a-zA-Z0-9_.-/]*)$/);
        
        if (match) {
            setShowMentionMenu(true);
            setMentionQuery(match[1] || "");
            setMentionIndex(0);
        } else {
            setShowMentionMenu(false);
        }
    };

    const addTag = (file: string) => {
        onTaggedFilesChange?.([...taggedFiles, file]);
        setShowMentionMenu(false);
        
        // Remove the @ query from the input text
        const cursor = textareaRef.current?.selectionStart || 0;
        const textBeforeCursor = value.slice(0, cursor);
        const textAfterCursor = value.slice(cursor);
        const newTextBefore = textBeforeCursor.replace(/@[a-zA-Z0-9_.-/]*$/, "");
        
        onChange(newTextBefore + textAfterCursor);
        
        setTimeout(() => {
            textareaRef.current?.focus();
            const newCursor = newTextBefore.length;
            textareaRef.current?.setSelectionRange(newCursor, newCursor);
        }, 0);
    };

    const removeTag = (file: string) => {
        onTaggedFilesChange?.(taggedFiles.filter(f => f !== file));
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        if (!disabled) setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (disabled) return;
        
        try {
            const data = e.dataTransfer.getData("text/plain");
            if (data && repositoryFiles.some(rf => rf.path === data)) {
               if(!taggedFiles.includes(data)) {
                   onTaggedFilesChange?.([...taggedFiles, data]);
               }
            } else {
                // Try from files if they dragged a real file, we can just take its name if it matches
                const files = Array.from(e.dataTransfer.files).map(f => f.name);
                let added = false;
                const newTags = [...taggedFiles];
                for(const f of files) {
                   const matched = repositoryFiles.find(rf => rf.path.endsWith(f) || rf.path === f);
                   if(matched && !newTags.includes(matched.path)) {
                       newTags.push(matched.path);
                       added = true;
                   }
                }
                if(added) onTaggedFilesChange?.(newTags);
            }
        } catch(err) {
            console.error("Drop failed", err);
        }
    };

    return (
        <div className="relative group/input max-w-4xl mx-auto flex flex-col gap-2">
            
            {showMentionMenu && filteredFiles.length > 0 && (
                <div className="absolute bottom-full left-0 mb-2 w-full max-w-md bg-zinc-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
                    <div className="p-2 flex flex-col gap-1 max-h-60 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--scrollbar-thumb) var(--scrollbar-track)' }}>
                        {filteredFiles.map((fileObj, idx) => (
                            <button
                                type="button"
                                key={fileObj.path}
                                onClick={() => addTag(fileObj.path)}
                                className={cn(
                                    "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-colors text-left",
                                    idx === mentionIndex ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                                )}
                            >
                                {fileObj.type === "tree" ? (
                                    <Folder className="w-4 h-4 text-orange-400 shrink-0" />
                                ) : (
                                    <FileCode className="w-4 h-4 text-purple-400 shrink-0" />
                                )}
                                <span className="truncate">{fileObj.path}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div 
                className={cn(
                    "relative flex flex-col md:flex-row md:items-center bg-zinc-900/50 backdrop-blur-xl border rounded-2xl p-2 transition-all shadow-2xl",
                    isDragging ? "border-purple-500 bg-purple-900/10 ring-2 ring-purple-500/30" : "border-white/10 focus-within:ring-2 focus-within:ring-purple-600/30",
                    isMobile ? "flex-col" : ""
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                {isDragging && (
                    <div className="absolute inset-0 z-50 rounded-2xl flex items-center justify-center bg-purple-900/50 backdrop-blur-sm border-2 border-dashed border-purple-500/50">
                        <span className="text-purple-200 font-bold tracking-tight">Drop files to add context</span>
                    </div>
                )}
                <div className="flex-1 min-w-0 flex flex-col">
                    {taggedFiles.length > 0 && (
                        <div className="flex flex-wrap gap-2 px-4 pt-2 -mb-2 z-10">
                            <AnimatePresence>
                                {taggedFiles.map(filePath => {
                                    const rf = repositoryFiles.find(r => r.path === filePath);
                                    const isFolder = rf?.type === "tree";
                                    return (
                                        <motion.span
                                            initial={{ opacity: 0, scale: 0.8 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0, scale: 0.8 }}
                                            key={filePath} 
                                            className={cn(
                                                "inline-flex items-center gap-1 px-2.5 py-1 rounded-md border text-[11px] font-medium max-w-full",
                                                isFolder ? "bg-orange-500/10 border-orange-500/20 text-orange-300" : "bg-purple-500/10 border-purple-500/20 text-purple-300"
                                            )}
                                        >
                                            {isFolder ? <Folder className="w-3 h-3 shrink-0" /> : <FileCode className="w-3 h-3 shrink-0" />}
                                            <span className="truncate">{filePath}</span>
                                            <button 
                                                type="button" 
                                                onClick={() => removeTag(filePath)}
                                                className={cn("rounded-full p-0.5 transition-colors shrink-0 outline-none", isFolder ? "hover:bg-orange-500/20" : "hover:bg-purple-500/20")}
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </motion.span>
                                    );
                                })}
                            </AnimatePresence>
                        </div>
                    )}
                    
                    <textarea
                        ref={textareaRef}
                        value={value}
                        onChange={(e) => handleChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={taggedFiles.length > 0 
                            ? "Add your message..." 
                            : (placeholder 
                                ? (isMobile ? placeholder.replace("(use @ or drop to tag)", "(use @ to tag)") : placeholder)
                                : (isMobile ? "Type @ to mention files..." : "Type @ to mention files or drag them here...")
                            )
                        }
                        disabled={disabled}
                        rows={1}
                        className={cn(
                            "block w-full bg-transparent border-none px-4 py-3 text-white text-sm md:text-base font-normal placeholder:font-normal placeholder:text-sm md:placeholder:text-base placeholder-zinc-500 focus:outline-none focus:ring-0 transition-all resize-none min-h-[52px] max-h-[200px] z-10",
                            disabled && "opacity-50 cursor-not-allowed"
                        )}
                        style={{
                            scrollbarWidth: 'thin',
                            scrollbarColor: 'var(--scrollbar-thumb) var(--scrollbar-track)',
                            overflowY: 'hidden'
                        }}
                    />
                </div>

                <div className="flex items-center gap-1.5 pr-2 pt-2 md:pt-0 pb-1 md:pb-0 z-10 self-end md:self-auto w-full md:w-auto justify-between md:justify-end border-t border-white/5 md:border-t-0 mt-2 md:mt-0" ref={dropdownRef}>
                    <div className="flex items-center gap-1.5 pl-2 md:pl-0">
                        {showCrossRepoToggle && (
                            <button
                                type="button"
                                onClick={() => {
                                    if (!crossRepoEnabled && !session) {
                                        onRequireCrossRepoAuth?.();
                                        return;
                                    }
                                    setCrossRepoEnabled?.(!crossRepoEnabled);
                                }}
                                className={cn(
                                    "flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold border transition-all",
                                    crossRepoEnabled
                                        ? "bg-blue-900/20 border-blue-500/30 text-blue-300 hover:bg-blue-900/30"
                                        : "bg-zinc-800/50 border-white/5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300",
                                    disabled && "opacity-50 cursor-not-allowed"
                                )}
                                title="Enable cross-repo context"
                            >
                                <Network className="w-3 h-3" />
                                <span className="uppercase tracking-wider hidden xs:inline">Cross-Repo</span>
                            </button>
                        )}
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => !disabled && setShowModelDropdown(!showModelDropdown)}
                                className={cn(
                                    "flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-bold border transition-all",
                                    modelPreference === "flash"
                                        ? "bg-zinc-800/50 border-white/5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
                                        : "bg-purple-900/20 border-purple-500/30 text-purple-300 hover:bg-purple-900/30",
                                    disabled && "opacity-50 cursor-not-allowed"
                                )}
                            >
                                {modelPreference === "flash" ? (
                                    <Zap className="w-3 h-3 text-yellow-500" />
                                ) : (
                                    <Brain className="w-3.5 h-3.5 text-purple-400" />
                                )}
                                <span className="uppercase tracking-wider hidden xs:inline">
                                    {modelPreference === "flash" ? "Lite" : "Thinking"}
                                </span>
                                <ChevronDown className={cn("w-3 h-3 transition-transform duration-200", showModelDropdown && "rotate-180")} />
                            </button>

                            <AnimatePresence>
                                {showModelDropdown && (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.95, y: 5 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.95, y: 5 }}
                                        className="absolute bottom-full right-0 mb-4 w-52 bg-zinc-900/90 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-50 p-1.5 flex flex-col gap-1"
                                    >
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setModelPreference?.("flash");
                                                setShowModelDropdown(false);
                                            }}
                                            className={cn(
                                                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs transition-colors",
                                                modelPreference === "flash" ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                                            )}
                                        >
                                            <div className="w-8 h-8 rounded-lg bg-yellow-500/10 flex items-center justify-center border border-yellow-500/20">
                                                <Zap className="w-3.5 h-3.5 text-yellow-500" />
                                            </div>
                                            <div className="flex flex-col items-start">
                                                <span className="font-semibold">Lite Mode</span>
                                                <span className="text-[10px] opacity-50">Standard performance</span>
                                            </div>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (!session) {
                                                    onRequireAuth?.();
                                                    return;
                                                }
                                                setModelPreference?.("thinking");
                                                setShowModelDropdown(false);
                                            }}
                                            className={cn(
                                                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs transition-colors",
                                                modelPreference === "thinking" ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                                            )}
                                        >
                                            <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
                                                <Brain className="w-4 h-4 text-purple-400" />
                                            </div>
                                            <div className="flex flex-col items-start">
                                                <span className="font-semibold">Thinking Mode</span>
                                                <span className="text-[10px] opacity-50">High reasoning depth</span>
                                            </div>
                                        </button>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading || disabled || (!value.trim() && !allowEmptySubmit && (taggedFiles?.length || 0) === 0)}
                        className="p-1 rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/60"
                    >
                        <div className={cn(
                            "w-10 h-10 rounded-2xl flex items-center justify-center transition-all border",
                            !disabled && (value.trim() || allowEmptySubmit || (taggedFiles?.length || 0) > 0)
                                ? "bg-purple-500/10 text-purple-400 border-purple-500/20 hover:bg-purple-500/20 hover:text-purple-300"
                                : "bg-transparent text-zinc-600 border-transparent opacity-50"
                        )}>
                            <Send className="w-4.5 h-4.5" />
                        </div>
                    </button>
                </div>
            </div>
        </div>
    );
}
