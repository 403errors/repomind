import { useRef, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Send, Zap, Brain, ChevronDown, Network } from "lucide-react";
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
}: ChatInputProps) {
    const { data: session } = useSession();
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [isMobile, setIsMobile] = useState(false);
    const [showModelDropdown, setShowModelDropdown] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

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

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
            e.preventDefault();
            if (!value.trim() && !allowEmptySubmit) return;
            onSubmit(e);
        }
    };

    return (
        <div className="relative group/input max-w-4xl mx-auto">


            <div className="relative flex items-center bg-zinc-900/50 backdrop-blur-xl border border-white/10 rounded-2xl p-2 focus-within:ring-2 focus-within:ring-purple-600/30 transition-all shadow-2xl">
                <textarea
                    ref={textareaRef}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    disabled={disabled}
                    rows={1}
                    className={cn(
                        "block w-full bg-transparent border-none px-4 py-3 text-white text-base placeholder-zinc-500 focus:outline-none focus:ring-0 transition-all resize-none min-h-[52px] max-h-[200px]",
                        disabled && "opacity-50 cursor-not-allowed"
                    )}
                    style={{
                        scrollbarWidth: 'thin',
                        scrollbarColor: 'var(--scrollbar-thumb) var(--scrollbar-track)',
                        overflowY: 'hidden'
                    }}
                />

                <div className="flex items-center gap-1.5 pr-2" ref={dropdownRef}>
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

                    <button
                        type="submit"
                        disabled={loading || disabled || (!value.trim() && !allowEmptySubmit)}
                        className="p-1 rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/60"
                    >
                        <div className={cn(
                            "w-10 h-10 rounded-2xl flex items-center justify-center transition-all border",
                            !disabled && value.trim()
                                ? "bg-gradient-to-br from-purple-700 via-purple-600 to-indigo-600 text-white border-purple-300/35 shadow-[0_10px_30px_-15px_rgba(147,51,234,0.85)] hover:-translate-y-0.5 hover:brightness-110 active:translate-y-0"
                                : "bg-zinc-800/80 text-zinc-500 border-white/10 opacity-60 shadow-none"
                        )}>
                            <Send className="w-4.5 h-4.5" />
                        </div>
                    </button>
                </div>
            </div>
        </div>
    );
}
