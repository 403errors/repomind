"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import mermaid from "mermaid";
import { validateMermaidSyntax, sanitizeMermaidCode, compileMermaidFromJSON } from "@/lib/diagram-utils";
import { Download, X, Maximize2, ZoomIn, Sparkles } from "lucide-react";
import { toast } from "sonner";
import html2canvas from "html2canvas-pro";
import { motion, AnimatePresence } from "framer-motion";
import { initMermaid } from "@/lib/mermaid-init";
import { APP_FONT_STACK } from "@/lib/design-tokens";
import { ensureMermaidMinimumDetail } from "@/lib/diagram-utils";

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

/**
 * Normalizes a Mermaid-generated SVG string to be fully responsive.
 *
 * Mermaid bakes absolute pixel dimensions (e.g. width="1200" height="850") into
 * every SVG it generates. When this is rendered inline in a chat container, the
 * fixed width overflows the container and the diagram looks visually broken.
 *
 * We use DOMParser — NOT regex — to manipulate the SVG safely. Regex was tried
 * multiple times and caused regressions (invalid attributes, double-replacement,
 * broken child elements). DOMParser gives us the actual DOM so we can:
 * 1. Read and remove the fixed width/height attributes cleanly.
 * 2. Synthesize a viewBox from them so the aspect ratio is preserved.
 * 3. Inject responsive CSS via the style property.
 *
 * This runs synchronously BEFORE the svg string is committed to React state,
 * meaning the very first browser paint is already correct — no rAF delay needed.
 */
function normalizeMermaidSvg(svgString: string): string {
    if (!svgString || typeof window === 'undefined') return svgString;

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgString, 'image/svg+xml');

        // If parsing failed, DOMParser returns a parseerror document
        const parseError = doc.querySelector('parsererror');
        if (parseError) return svgString;

        const svgEl = doc.querySelector('svg');
        if (!svgEl) return svgString;

        const rawW = svgEl.getAttribute('width');
        const rawH = svgEl.getAttribute('height');
        const hasViewBox = svgEl.hasAttribute('viewBox');

        // Synthesize viewBox from the pixel dimensions before removing them
        if (!hasViewBox && rawW && rawH) {
            const w = parseFloat(rawW);
            const h = parseFloat(rawH);
            if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
                svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
            }
        }

        // Remove fixed dimensions — SVG will scale via CSS instead
        svgEl.removeAttribute('width');
        svgEl.removeAttribute('height');

        // Set responsive CSS. `height: auto` is valid in CSS (not as SVG attr).
        svgEl.style.width = '100%';
        svgEl.style.height = 'auto';
        svgEl.style.overflow = 'visible';
        svgEl.style.maxHeight = 'none';
        svgEl.style.fontFamily = APP_FONT_STACK;

        const existingStyle = doc.querySelector('style[data-repomind-font]');
        if (!existingStyle) {
            const styleEl = doc.createElement('style');
            styleEl.setAttribute('data-repomind-font', 'true');
            styleEl.textContent = `svg, svg * { font-family: ${APP_FONT_STACK} !important; } .label, .nodeLabel, .edgeLabel { font-family: ${APP_FONT_STACK} !important; }`;
            doc.documentElement.insertBefore(styleEl, doc.documentElement.firstChild);
        }

        return new XMLSerializer().serializeToString(doc.documentElement);
    } catch {
        // If anything goes wrong, return the original unchanged to avoid blank diagrams
        return svgString;
    }
}

function applyResponsiveSvgSizing(svgElement: SVGSVGElement): void {
    const rawW = svgElement.getAttribute('width');
    const rawH = svgElement.getAttribute('height');
    const hasViewBox = svgElement.hasAttribute('viewBox');

    if (!hasViewBox && rawW && rawH) {
        const w = parseFloat(rawW);
        const h = parseFloat(rawH);
        if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
            svgElement.setAttribute('viewBox', `0 0 ${w} ${h}`);
        }
    }

    svgElement.removeAttribute('width');
    svgElement.removeAttribute('height');
    svgElement.style.width = '100%';
    svgElement.style.height = 'auto';
    svgElement.style.overflow = 'visible';
    svgElement.style.maxHeight = 'none';
    svgElement.style.fontFamily = APP_FONT_STACK;
}

function resetAnimatedSvgStyles(svgElement: SVGSVGElement): void {
    const animatedElements = svgElement.querySelectorAll<SVGElement>(".node, .actor, .state, .class-name, path");
    animatedElements.forEach((element) => {
        element.getAnimations?.().forEach((animation) => animation.cancel());
    });

    const allNodes = svgElement.querySelectorAll<SVGElement>(".node, .actor, .state, .class-name");
    allNodes.forEach((node) => {
        node.style.removeProperty('opacity');
        node.style.removeProperty('transform');
        node.style.removeProperty('transform-origin');
    });

    const allPaths = svgElement.querySelectorAll<SVGElement>("path");
    allPaths.forEach((path) => {
        path.style.removeProperty('stroke-dasharray');
        path.style.removeProperty('stroke-dashoffset');
    });
}

function runMermaidEntranceAnimations(svgElement: SVGSVGElement): Animation[] {
    const runningAnimations: Animation[] = [];

    // Animate edge paths (drawing effect)
    const paths = svgElement.querySelectorAll<SVGPathElement>("path.edgePath path, path.flowchart-link, .sequence-diagram path");
    paths.forEach((path, i) => {
        try {
            const length = path.getTotalLength();
            if (length < 5) return;
            const stagger = Math.min(i * 20, 240);
            const animation = path.animate([
                { strokeDasharray: `${length}`, strokeDashoffset: length },
                { strokeDasharray: `${length}`, strokeDashoffset: 0 }
            ], {
                duration: 800 + (length / 2),
                delay: stagger,
                fill: "none",
                easing: "ease-out"
            });
            runningAnimations.push(animation);
        } catch {
            // Ignore paths that don't support getTotalLength
        }
    });

    // Animate nodes
    const nodes = svgElement.querySelectorAll<SVGElement>(".node, .actor, .state, .class-name");
    nodes.forEach((node, i) => {
        const stagger = Math.min(i * 18, 180);
        const animation = node.animate([
            { opacity: 0 },
            { opacity: 1 }
        ], {
            duration: 420,
            delay: stagger,
            fill: "none",
            easing: "ease-out"
        });
        runningAnimations.push(animation);
    });

    return runningAnimations;
}


export const Mermaid = ({ chart, isStreaming = false }: MermaidProps) => {
    const [svg, setSvg] = useState<string>("");
    const [error, setError] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isFixing, setIsFixing] = useState(false);
    const diagramRef = useRef<HTMLDivElement>(null);
    const modalRef = useRef<HTMLDivElement>(null);
    const lastAnimatedSvgRef = useRef("");
    const streamAnimationPlayedRef = useRef(false);
    const prevStreamingRef = useRef(isStreaming);
    const isGenerating = isFixing || isStreaming;
    // During streaming, we don't want to show the full-screen blurring overlay because it makes it
    // look like the UI is blocked. Only show it if we are fixing the diagram or if we have no SVG at all
    // and are NOT in the middle of a stream (i.e. first render or explicit generation).
    const showOverlay = !svg && (isFixing || isGenerating);

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
                let isTypedMermaidJson = false;

                // Check if the content is JSON (starts with {)
                // This handles cases where the LLM uses ```mermaid for JSON content
                if (chart.trim().startsWith('{')) {
                    try {
                        console.log('🔍 Detected JSON content in Mermaid block, converting...');
                        const data = JSON.parse(chart);
                        const compiled = compileMermaidFromJSON(data);
                        if (!compiled.valid || !compiled.mermaid) {
                            if (mounted) {
                                setIsFixing(false);
                                setError(compiled.error || "Unsupported mermaid-json payload");
                            }
                            return;
                        }
                        codeToRender = compiled.mermaid;
                        isTypedMermaidJson = true;
                        console.log('✅ Converted JSON to Mermaid:', codeToRender);
                    } catch (e) {
                        console.warn('⚠️ Failed to parse JSON in Mermaid block:', e);
                        // Continue with original content if parsing fails
                    }
                }

                // Layer 1: Basic sanitization (fast, catches obvious issues)
                console.log('🔄 Attempting Layer 1: Basic sanitization...');
                const detailed = ensureMermaidMinimumDetail(codeToRender, chart);
                const sanitized = sanitizeMermaidCode(detailed);
                const validation = validateMermaidSyntax(sanitized);

                if (!validation.valid) {
                    console.warn('⚠️ Validation warning:', validation.error);
                }

                // Try rendering with sanitized code
                try {
                    const { svg: newSvg } = await mermaid.render(id, sanitized);
                    if (mounted) {
                        setSvg(normalizeMermaidSvg(newSvg));
                        setError(null);
                        setIsFixing(false);
                    }
                    return; // Success!
                } catch (renderError: unknown) {
                    // If we are streaming, don't show error yet — diagram is still being built
                    if (isStreaming) {
                        // In streaming mode, we expect partial syntax errors. Skip console error noise.
                        return;
                    }

                    if (isTypedMermaidJson) {
                        if (mounted) {
                            setIsFixing(false);
                            const errorMessage = extractErrorMessage(renderError) || 'Syntax error in diagram';
                            const isInternalError = errorMessage.includes('dmermaid') ||
                                errorMessage.includes('#') ||
                                errorMessage.startsWith('Parse error');

                            const sanitizedError = isInternalError ? 'Syntax error in diagram' : errorMessage;
                            setError(sanitizedError);
                        }
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
                                        setSvg(normalizeMermaidSvg(fixedSvg));
                                        setError(null);
                                        setIsFixing(false);
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
                if (!isStreaming) {
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
    }, [chart, id, isStreaming]);

    useEffect(() => {
        if (isStreaming && !prevStreamingRef.current) {
            streamAnimationPlayedRef.current = false;
        }
        prevStreamingRef.current = isStreaming;
    }, [isStreaming]);

    const handleRetry = async () => {
        if (!chart) return;
        setError(null);
        setIsFixing(true);

        try {
            let codeToRender = chart;
            if (chart.trim().startsWith("{")) {
                try {
                    const compiled = compileMermaidFromJSON(JSON.parse(chart));
                    if (!compiled.valid || !compiled.mermaid) {
                        setError(compiled.error || "Unsupported mermaid-json payload");
                        return;
                    }
                    codeToRender = compiled.mermaid;
                    const { svg } = await mermaid.render(id + '-manualfixed', codeToRender);
                    setSvg(normalizeMermaidSvg(svg));
                    setError(null);
                    console.log('✅ Layer 3 successful: Typed Mermaid JSON re-rendered');
                    return;
                } catch (e: unknown) {
                    setError(extractErrorMessage(e) || "Failed to re-render diagram");
                    return;
                }
            }

            // Layer 3: Manual AI-powered syntax fix (if auto-fix failed or user wants to try again)
            console.log('🔄 Attempting Layer 3: Manual AI-powered fix...');
            const sanitized = sanitizeMermaidCode(codeToRender);

            const response = await fetch('/api/fix-mermaid', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: sanitized })
            });

            if (response.ok) {
                const { fixed } = await response.json();
                if (fixed) {
                    const { svg } = await mermaid.render(id + '-manualfixed', fixed);
                    setSvg(normalizeMermaidSvg(svg));
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

    // Apply responsive sizing and entrance animations after the SVG is in the DOM.
    // IMPORTANT: We use requestAnimationFrame to ensure React's batch update has
    // fully committed the new svg state before we query the DOM. Without rAF,
    // React may still be reconciling when this effect fires, causing the svgElement
    // to still have stale inline styles (opacity:0) from a previous animation cycle.
    useEffect(() => {
        if (!svg || !diagramRef.current) return;

        const runningAnimations: Animation[] = [];

        const raf = requestAnimationFrame(() => {
            const container = diagramRef.current;
            if (!container) return;
            const svgElement = container.querySelector("svg");
            if (!svgElement) return;

            const shouldAnimate =
                isStreaming
                    ? !streamAnimationPlayedRef.current && lastAnimatedSvgRef.current !== svg
                    : !streamAnimationPlayedRef.current && lastAnimatedSvgRef.current !== svg;

            if (!shouldAnimate) {
                lastAnimatedSvgRef.current = svg;
                return;
            }

            // Only reset styles when we are actually going to animate.
            applyResponsiveSvgSizing(svgElement);
            resetAnimatedSvgStyles(svgElement);
            runningAnimations.push(...runMermaidEntranceAnimations(svgElement));

            if (isStreaming) {
                streamAnimationPlayedRef.current = true;
            }
            lastAnimatedSvgRef.current = svg;
        });

        return () => {
            cancelAnimationFrame(raf);
            runningAnimations.forEach((animation) => animation.cancel());
        };
    }, [svg, isStreaming]);

    useEffect(() => {
        if (!isModalOpen || !modalRef.current) return;

        let runningAnimations: Animation[] = [];
        const timer = setTimeout(() => {
            const container = modalRef.current;
            if (!container) return;
            const svgElement = container.querySelector("svg");
            if (!svgElement) return;

            applyResponsiveSvgSizing(svgElement);
            resetAnimatedSvgStyles(svgElement);
            runningAnimations = runMermaidEntranceAnimations(svgElement);
        }, 300);

        return () => {
            clearTimeout(timer);
            runningAnimations.forEach((animation) => animation.cancel());
        };
    }, [isModalOpen, svg]);

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
                    className="overflow-x-auto bg-zinc-950/50 p-4 md:p-8 rounded-lg border border-white/5 hover:border-white/10 transition-colors flex justify-center min-w-0"
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
                                        max-height: none !important;
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
