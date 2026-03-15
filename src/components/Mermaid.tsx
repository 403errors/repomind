"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import mermaid from "mermaid";
import { validateMermaidSyntax, sanitizeMermaidCode, generateMermaidFromJSON } from "@/lib/diagram-utils";
import { Download, X, Maximize2, ZoomIn, Sparkles } from "lucide-react";
import { toast } from "sonner";
import html2canvas from "html2canvas-pro";
import { motion, AnimatePresence } from "framer-motion";
import { initMermaid } from "@/lib/mermaid-init";

// Initialize mermaid once
initMermaid();

interface MermaidProps {
    chart: string;
    isStreaming?: boolean;
}

function extractErrorMessage(error: unknown): string {
    if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
        return (error as { message: string }).message;
    }
    return "Failed to process diagram";
}

export const Mermaid = ({ chart, isStreaming = false }: MermaidProps) => {
    const [svg, setSvg] = useState<string>("");
    const [error, setError] = useState<string | null>(null);
    const [isInternalStreaming, setIsInternalStreaming] = useState(isStreaming);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isFixing, setIsFixing] = useState(false);
    const diagramRef = useRef<HTMLDivElement>(null);
    const modalRef = useRef<HTMLDivElement>(null);
    // Use a ref so the effect can read the latest streaming state without being a dependency
    const isInternalStreamingRef = useRef(isInternalStreaming);
    isInternalStreamingRef.current = isInternalStreaming;
    const isGenerating = isFixing || isInternalStreaming || (isStreaming && !svg);
    // During streaming, we don't want to show the full-screen blurring overlay because it makes it
    // look like the UI is blocked. Only show it if we are fixing the diagram or if we have no SVG at all
    // and are NOT in the middle of a stream (i.e. first render or explicit generation).
    const showOverlay = !svg && (isFixing || (!isStreaming && isGenerating));

    useEffect(() => {
        if (isStreaming) {
            setIsInternalStreaming(true);
        }
    }, [isStreaming]);

    // Use a stable ID based on chart content to prevent re-renders
    const id = useMemo(() => {
        // Simple hash function for stable ID
        let hash = 0;
        for (let i = 0; i < chart.length; i++) {
            const char = chart.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return `mermaid-${Math.abs(hash).toString(36)}`;
    }, [chart]);

    useEffect(() => {
        if (!chart) return;

        // Each render attempt has its own "generation" counter so that a stale
        // async result from a previous chart/id does not overwrite a newer one.
        let mounted = true;

        const renderDiagram = async (retryCount = 0) => {
            try {
                let codeToRender = chart;

                // Check if the content is JSON (starts with {)
                // This handles cases where the LLM uses ```mermaid for JSON content
                if (chart.trim().startsWith('{')) {
                    try {
                        console.log('🔍 Detected JSON content in Mermaid block, converting...');
                        const data = JSON.parse(chart);
                        codeToRender = generateMermaidFromJSON(data);
                        console.log('✅ Converted JSON to Mermaid:', codeToRender);
                    } catch (e) {
                        console.warn('⚠️ Failed to parse JSON in Mermaid block:', e);
                        // Continue with original content if parsing fails
                    }
                }

                // Layer 1: Basic sanitization (fast, catches obvious issues)
                console.log('🔄 Attempting Layer 1: Basic sanitization...');
                const sanitized = sanitizeMermaidCode(codeToRender);
                const validation = validateMermaidSyntax(sanitized);

                if (!validation.valid) {
                    console.warn('⚠️ Validation warning:', validation.error);
                }

                // Try rendering with sanitized code
                try {
                    const { svg: newSvg } = await mermaid.render(id, sanitized);
                    if (mounted) {
                        setSvg(newSvg);
                        setError(null);
                        setIsFixing(false);
                        setIsInternalStreaming(false);
                    }
                    return; // Success!
                } catch (renderError: unknown) {
                    // If we are streaming, don't show error yet — diagram is still being built
                    if (isStreaming || isInternalStreamingRef.current) {
                        // In streaming mode, we expect partial syntax errors. Skip console error noise.
                        return;
                    }

                    // PROACTIVE AI FIXING (Layer 2 Auto-Trigger)
                    // If this is the first failure and not streaming, try to auto-fix immediately
                    if (retryCount === 0 && mounted) {
                        console.log('🔄 Auto-triggering Layer 2: Proactive AI fix...');
                        setIsFixing(true);
                        setError(null); // Clear error while fixing

                        try {
                            const response = await fetch('/api/fix-mermaid', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ code: sanitized })
                            });

                            if (response.ok) {
                                const { fixed } = await response.json();
                                if (fixed) {
                                    console.log('✅ AI Fix received, retrying render...');
                                    const { svg: fixedSvg } = await mermaid.render(id + '-autofixed', fixed);
                                    if (mounted) {
                                        setSvg(fixedSvg);
                                        setError(null);
                                        setIsFixing(false);
                                        setIsInternalStreaming(false);
                                    }
                                    return;
                                }
                            }
                        } catch (aiError) {
                            console.warn('⚠️ Auto-fix failed:', aiError);
                        }
                    }

                    if (mounted) {
                        setIsFixing(false);
                        const errorMessage = extractErrorMessage(renderError) || 'Syntax error in diagram';
                        const isInternalError = errorMessage.includes('dmermaid') ||
                            errorMessage.includes('#') ||
                            errorMessage.startsWith('Parse error');

                        const sanitizedError = isInternalError ? 'Syntax error in diagram' : errorMessage;
                        setError(sanitizedError);
                    }
                }
            } catch (error: unknown) {
                if (!isStreaming && !isInternalStreamingRef.current) {
                    console.error('Complete render failure:', error);
                    if (mounted) {
                        setIsFixing(false);
                        setError('Failed to render diagram');
                    }
                }
            }
        };

        // Use a small delay for streaming to avoid overwhelming the CPU
        const timer = setTimeout(renderDiagram, isStreaming ? 300 : 0);

        return () => {
            mounted = false;
            clearTimeout(timer);
        };
        // NOTE: isInternalStreaming is intentionally excluded from deps — we read it
        // via isInternalStreamingRef so the effect doesn't re-trigger when it flips
        // to false after a successful render (which was the source of the flicker).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chart, id, isStreaming]);

    const handleRetry = async () => {
        if (!chart) return;
        setError(null);
        setIsFixing(true);

        try {
            // Layer 3: Manual AI-powered syntax fix (if auto-fix failed or user wants to try again)
            console.log('🔄 Attempting Layer 3: Manual AI-powered fix...');
            const sanitized = sanitizeMermaidCode(chart);

            const response = await fetch('/api/fix-mermaid', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: sanitized })
            });

            if (response.ok) {
                const { fixed } = await response.json();
                if (fixed) {
                    const { svg } = await mermaid.render(id + '-manualfixed', fixed);
                    setSvg(svg);
                    setError(null);
                    console.log('✅ Layer 3 successful: Manual AI fix worked');
                    return;
                }
            }
            setError("Could not automatically fix the diagram. Please try asking again.");
        } catch (e: unknown) {
            setError(extractErrorMessage(e) || "Failed to fix diagram");
        } finally {
            setIsFixing(false);
        }
    };

    // Add drawing animation to the SVG paths
    useEffect(() => {
        if (!svg || isGenerating || !diagramRef.current) return;

        const container = diagramRef.current;
        const svgElement = container.querySelector("svg");
        if (!svgElement) return;

        // Force overflow visible for animations
        svgElement.style.overflow = "visible";

        // Animate paths (drawing effect)
        const paths = svgElement.querySelectorAll("path.edgePath path, path.flowchart-link, .sequence-diagram path");
        paths.forEach((path: any, i) => {
            try {
                const length = path.getTotalLength();
                if (length < 5) return; // Skip tiny paths

                path.style.strokeDasharray = `${length}`;
                path.style.strokeDashoffset = `${length}`;
                path.animate([
                    { strokeDashoffset: length },
                    { strokeDashoffset: 0 }
                ], {
                    duration: 800 + (length / 2),
                    delay: i * 50,
                    fill: "forwards",
                    easing: "ease-out"
                });
            } catch (e) {
                // Ignore errors for paths that don't support getTotalLength
            }
        });

        // Animate nodes
        const nodes = svgElement.querySelectorAll(".node, .actor, .state, .class-name");
        nodes.forEach((node: any, i) => {
            node.style.opacity = "0";
            node.style.transformOrigin = "center";
            node.animate([
                { opacity: 0, transform: "scale(0.9)" },
                { opacity: 1, transform: "scale(1)" }
            ], {
                duration: 500,
                delay: i * 30 + 200,
                fill: "forwards",
                easing: "cubic-bezier(0.34, 1.56, 0.64, 1)"
            });
        });
    }, [svg, isGenerating]);

    const exportToPNG = async (e?: React.MouseEvent) => {
        e?.stopPropagation(); // Prevent modal opening if clicking export button
        // Use the ref that is currently visible (modal or inline)
        const element = isModalOpen ? modalRef.current : diagramRef.current;
        if (!element) return;

        try {
            const canvas = await html2canvas(element, {
                backgroundColor: '#18181b', // zinc-900
                scale: 2, // Higher resolution
            });

            const link = document.createElement('a');
            link.download = `architecture-diagram-${Date.now()}.png`;
            link.href = canvas.toDataURL();
            link.click();
            toast.success('Diagram exported successfully!');
        } catch (error) {
            console.error('Export failed:', error);
            toast.error('Failed to export diagram');
        }
    };

    return (
        <>
            <div
                className={`my-4 group relative ${isGenerating ? "cursor-default" : "cursor-zoom-in"}`}
                onClick={() => {
                    if (!isGenerating && svg) {
                        setIsModalOpen(true);
                    }
                }}
            >
                <div
                    ref={diagramRef}
                    className="overflow-x-auto bg-zinc-950/50 p-4 rounded-lg border border-white/5 hover:border-white/10 transition-colors flex justify-center min-w-0"
                    dangerouslySetInnerHTML={{ __html: svg }}
                    style={{ minHeight: svg ? 'auto' : '200px' }}
                />

                {/* Overlay controls */}
                {!isGenerating && svg && (
                    <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                        <button
                            onClick={exportToPNG}
                            className="p-2 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white rounded-lg backdrop-blur-sm"
                            title="Export as PNG"
                        >
                            <Download className="w-4 h-4" />
                        </button>
                        <button
                            className="p-2 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white rounded-lg backdrop-blur-sm"
                            title="View Fullscreen"
                        >
                            <Maximize2 className="w-4 h-4" />
                        </button>
                    </div>
                )}

                {showOverlay && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900/50 backdrop-blur-sm rounded-lg z-10">
                        <div className="flex items-center gap-2 text-zinc-400">
                            <Sparkles className="w-5 h-5 animate-pulse text-purple-400" />
                            <span className="text-sm font-medium">
                                {isFixing ? "Fixing diagram..." : "Generating diagram..."}
                            </span>
                        </div>
                    </div>
                )}

                {error && !isFixing && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900/90 backdrop-blur-sm rounded-lg p-4 text-center z-10">
                        <p className="text-red-400 text-sm mb-3 max-w-[90%] break-words">{error}</p>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                handleRetry();
                            }}
                            className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg text-sm transition-colors flex items-center gap-2"
                        >
                            <Sparkles className="w-4 h-4" />
                            Fix Diagram
                        </button>
                    </div>
                )}
            </div>

            {/* Fullscreen Modal */}
            <AnimatePresence>
                {isModalOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 md:p-8"
                        onClick={() => setIsModalOpen(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="relative w-full max-w-[95vw] max-h-[95vh] bg-zinc-900 rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex flex-col"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Header */}
                            <div className="flex items-center justify-between p-4 border-b border-white/10 bg-zinc-900/50">
                                <h3 className="text-sm font-medium text-zinc-400 flex items-center gap-2">
                                    <ZoomIn className="w-4 h-4" />
                                    Diagram Preview
                                </h3>
                                <div className="flex items-center gap-2">
                                    {!isGenerating && svg && (
                                        <button
                                            onClick={exportToPNG}
                                            className="p-2 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors"
                                            title="Export as PNG"
                                        >
                                            <Download className="w-5 h-5" />
                                        </button>
                                    )}
                                    <button
                                        onClick={() => setIsModalOpen(false)}
                                        className="p-2 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors"
                                        title="Close"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>

                            {/* Content */}
                            <div className="flex-1 overflow-auto bg-zinc-950/50 relative custom-scrollbar diagram-modal-content">
                                <style>{`
                                    .diagram-modal-content svg {
                                        width: 100% !important;
                                        height: auto !important;
                                        max-width: 100% !important;
                                        max-height: 80vh !important;
                                        color-scheme: dark;
                                    }
                                `}</style>
                                <div className="min-h-full w-full flex items-center justify-center p-4 md:p-12">
                                    <motion.div
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: 0.2 }}
                                        ref={modalRef}
                                        className="bg-zinc-900/40 p-8 rounded-2xl border border-white/10 backdrop-blur-md shadow-2xl flex items-center justify-center"
                                        style={{ minWidth: 'min(90vw, 800px)' }}
                                        dangerouslySetInnerHTML={{ __html: svg }}
                                    />
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
};
