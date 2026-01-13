import { useRef, useEffect, useState } from "react";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatInputProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (e: React.FormEvent) => void;
    placeholder?: string;
    disabled?: boolean;
    loading?: boolean;
    allowEmptySubmit?: boolean;
}

export function ChatInput({ value, onChange, onSubmit, placeholder, disabled, loading, allowEmptySubmit }: ChatInputProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.matchMedia('(pointer: coarse)').matches);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    const adjustHeight = () => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            const newHeight = Math.min(textarea.scrollHeight, 200);
            textarea.style.height = `${newHeight}px`;

            // Only show scrollbar if content exceeds max height
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
        <div className="relative">
            <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                disabled={disabled}
                rows={1}
                className={cn(
                    "w-full bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 pr-12 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-purple-600/50 transition-all resize-none min-h-[48px] max-h-[200px]",
                    disabled && "opacity-50 cursor-not-allowed"
                )}
                style={{
                    scrollbarWidth: 'thin',
                    scrollbarColor: '#52525b transparent',
                    overflowY: 'hidden' // Default to hidden
                }}
            />
            <button
                type="submit"
                disabled={loading || disabled || (!value.trim() && !allowEmptySubmit)}
                className="absolute right-2 bottom-2 p-2 text-zinc-400 hover:text-white disabled:opacity-50 transition-colors"
            >
                <Send className="w-5 h-5" />
            </button>
        </div>
    );
}
