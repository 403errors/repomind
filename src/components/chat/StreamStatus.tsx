import { Loader2, Search, Wrench } from "lucide-react";

interface StreamStatusProps {
    message?: string;
    isStreaming: boolean;
}

export function StreamStatus({ message, isStreaming }: StreamStatusProps) {
    if (!isStreaming || !message) return null;

    const normalized = message.trim();
    const isGoogleSearch = /^Searching Google for /i.test(normalized);
    const isToolCall = /^Calling /i.test(normalized);

    return (
        <div className="not-prose mb-1.5 w-full max-w-full rounded-xl border border-white/10 bg-zinc-900/70 px-3 py-2.5 min-h-10 overflow-hidden">
            <div className="flex items-start gap-2 text-sm leading-5 text-zinc-300 min-w-0">
                {isGoogleSearch ? (
                    <Search className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
                ) : isToolCall ? (
                    <Wrench className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
                ) : (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400 shrink-0 mt-0.5" />
                )}
                <span className="flex-1 min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">{normalized}</span>
            </div>
        </div>
    );
}
