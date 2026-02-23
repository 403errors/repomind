import { useRef, useEffect, useState } from "react";
import { Send, Zap, Brain, ChevronDown } from "lucide-react";
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
    setModelPreference
}: ChatInputProps) {
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
        <div className="relative group/input">
            <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                disabled={disabled}
                rows={1}
                className={cn(
                    "w-full bg-zinc-900 border border-white/10 rounded-2xl px-4 pt-3 pb-3 pr-28 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-purple-600/50 transition-all resize-none min-h-[52px] max-h-[200px]",
                    disabled && "opacity-50 cursor-not-allowed"
                )}
                style={{
                    scrollbarWidth: 'thin',
                    scrollbarColor: '#52525b transparent',
                    overflowY: 'hidden'
                }}
            />

            <div className="absolute right-2 bottom-2 flex items-center gap-1.5" ref={dropdownRef}>
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => !disabled && setShowModelDropdown(!showModelDropdown)}
                        className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-bold border transition-all",
                            modelPreference === "flash"
                                ? "bg-zinc-800/50 border-white/5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
                                : "bg-purple-900/20 border-purple-500/30 text-purple-300 hover:bg-purple-900/30",
                            disabled && "opacity-50 cursor-not-allowed"
                        )}
                    >
                        {modelPreference === "flash" ? (
                            <Zap className="w-3 h-3 text-yellow-500" />
                        ) : (
                            <Brain className="w-3 h-3 text-purple-400" />
                        )}
                        <span className="uppercase tracking-wider hidden xs:inline">
                            {modelPreference === "flash" ? "Flash" : "Thinking"}
                        </span>
                        <ChevronDown className={cn("w-3 h-3 transition-transform duration-200", showModelDropdown && "rotate-180")} />
                    </button>

                    <AnimatePresence>
                        {showModelDropdown && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95, y: 5 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: 5 }}
                                className="absolute bottom-full right-0 mb-2 w-48 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 p-1"
                            >
                                <button
                                    type="button"
                                    onClick={() => {
                                        setModelPreference?.("flash");
                                        setShowModelDropdown(false);
                                    }}
                                    className={cn(
                                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs transition-colors",
                                        modelPreference === "flash" ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                                    )}
                                >
                                    <div className="w-7 h-7 rounded-lg bg-yellow-500/10 flex items-center justify-center border border-yellow-500/20">
                                        <Zap className="w-3.5 h-3.5 text-yellow-500" />
                                    </div>
                                    <div className="flex flex-col items-start">
                                        <span className="font-semibold">Flash Mode</span>
                                        <span className="text-[10px] opacity-50">Standard performance</span>
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setModelPreference?.("thinking");
                                        setShowModelDropdown(false);
                                    }}
                                    className={cn(
                                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs transition-colors",
                                        modelPreference === "thinking" ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                                    )}
                                >
                                    <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
                                        <Brain className="w-3.5 h-3.5 text-purple-400" />
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
                    className="p-1 rounded-lg transition-colors"
                >
                    <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-lg",
                        !disabled && value.trim() ? "bg-gradient-to-tr from-purple-600 to-indigo-600 text-white scale-110" : "bg-zinc-800 text-zinc-500 opacity-50"
                    )}>
                        <Send className="w-4 h-4" />
                    </div>
                </button>
            </div>
        </div>
    );
}
