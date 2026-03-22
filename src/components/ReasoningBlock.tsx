import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReasoningBlockProps {
    steps: string[];
    isStreaming?: boolean;
}

export function ReasoningBlock({ steps, isStreaming }: ReasoningBlockProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    // Filter out generic status steps
    const filteredSteps = (steps || []).filter(step =>
        !step.startsWith("Reasoning:") && !step.startsWith("Process:") && !step.startsWith("STATUS:")
    );

    const hasRealThoughts = filteredSteps.length > 0;

    // Pure "Thinking..." pre-step state: streaming but no real content yet
    if (!hasRealThoughts && isStreaming) {
        return (
            <div className="not-prose select-none flex min-h-10 items-center">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-widest text-purple-400/80">
                        Thinking
                    </span>
                    <span className="flex gap-0.5 items-center">
                        {[0, 1, 2].map(i => (
                            <motion.span
                                key={i}
                                className="w-1 h-1 rounded-full bg-purple-400"
                                animate={{ opacity: [0.3, 1, 0.3] }}
                                transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                            />
                        ))}
                    </span>
                </div>
            </div>
        );
    }

    // Nothing to show if no steps and not streaming
    if (!hasRealThoughts && !isStreaming) return null;

    const currentStep = filteredSteps[filteredSteps.length - 1];

    // Helper to format a reasoning step
    const formatStep = (step: string) => {
        const match = step.match(/^\*\*([^*]+)\*\*([\s\S]*)/);
        if (match) {
            return (
                <div>
                    <span className="font-semibold text-zinc-300">{match[1]}</span>
                    {match[2] && <div className="mt-1 text-zinc-500">{match[2].trim()}</div>}
                </div>
            );
        }
        return step;
    };

    // Helper to get just the title of the current step
    const getCurrentStepTitle = (step: string) => {
        const match = step.match(/^\*\*([^*]+)\*\*/);
        if (match) return match[1];
        const cleanStep = step.replace(/^(Reasoning|Process|STATUS):\s*/, '');
        return cleanStep.length > 60 ? cleanStep.substring(0, 60) + "..." : cleanStep;
    };

    return (
        <div className="mb-2 not-prose select-none">
            {/* Reasoning label + expand toggle */}
            <button
                onClick={() => hasRealThoughts && setIsExpanded(v => !v)}
                disabled={!hasRealThoughts}
                className={cn(
                    "flex items-start sm:items-center gap-2 mb-1.5 group outline-none max-w-full text-left min-h-10 min-w-0",
                    !hasRealThoughts && "cursor-default"
                )}
            >
                <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-semibold uppercase tracking-widest text-purple-400/80 group-hover:text-purple-400 transition-colors">
                        {isStreaming ? "Thinking" : "Reasoned"}
                    </span>

                    {isStreaming && (
                        <span className="flex gap-0.5 items-center">
                            {[0, 1, 2].map(i => (
                                <motion.span
                                    key={i}
                                    className="w-1 h-1 rounded-full bg-purple-400"
                                    animate={{ opacity: [0.3, 1, 0.3] }}
                                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                                />
                            ))}
                        </span>
                    )}

                    {/* Dropdown arrow — only when collapsed with steps available */}
                    {hasRealThoughts && (
                        <motion.span
                            animate={{ rotate: isExpanded ? 180 : 0 }}
                            transition={{ duration: 0.15 }}
                            className="inline-flex shrink-0 text-zinc-500 group-hover:text-zinc-400 transition-colors"
                        >
                            <ChevronDown className="w-3.5 h-3.5" />
                        </motion.span>
                    )}
                </div>

                {/* Inline current reasoning step (shown when collapsed) */}
                {!isExpanded && currentStep && (
                    <div className="text-xs text-zinc-500 flex-1 min-w-0 pr-2 whitespace-normal break-words [overflow-wrap:anywhere] sm:truncate sm:whitespace-nowrap sm:pr-4">
                        {getCurrentStepTitle(currentStep)}
                    </div>
                )}
            </button>

            {/* Expanded: all steps as a timeline */}
            <AnimatePresence>
                {isExpanded && hasRealThoughts && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.18 }}
                        className="overflow-hidden"
                    >
                        <div className="mt-2 space-y-3 pl-3 border-l border-purple-500/20">
                            {filteredSteps.map((step, idx) => {
                                const isCurrent = idx === filteredSteps.length - 1;
                                return (
                                    <div
                                        key={idx}
                                        className={cn(
                                            "text-xs leading-relaxed break-words min-w-0",
                                            isCurrent && isStreaming
                                                ? "text-zinc-300"
                                                : "text-zinc-500"
                                        )}
                                    >
                                        {formatStep(step)}
                                    </div>
                                );
                            })}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
