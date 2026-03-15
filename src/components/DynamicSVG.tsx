"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { Download, Maximize2, X, ZoomIn, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import html2canvas from "html2canvas-pro";

interface DynamicSVGProps {
    svg: string;
    isStreaming?: boolean;
}

export const DynamicSVG = ({ svg, isStreaming = false }: DynamicSVGProps) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const modalRef = useRef<HTMLDivElement>(null);
    const [hasAnimated, setHasAnimated] = useState(false);

    // Clean up the SVG string - sometimes LLMs add markdown noise
    const cleanSvg = useMemo(() => {
        let cleaned = svg.trim();
        if (cleaned.startsWith("```svg")) {
            cleaned = cleaned.replace(/^```svg\n?/, "").replace(/\n?```$/, "");
        }
        
        // Remove potential <?xml ... ?> and <!DOCTYPE ... > tags if they exist
        cleaned = cleaned.replace(/<\?xml.*?\?>/i, "").replace(/<!DOCTYPE.*?>/i, "");
        
        // Robustness: If the SVG is being streamed and tag is not closed, close it for rendering
        if (isStreaming && cleaned.includes("<svg") && !cleaned.includes("</svg>")) {
            cleaned += "</svg>";
        }

        // Enhance SVG tag for responsiveness
        if (cleaned.includes("<svg")) {
            // Ensure width/height are set to 100% / auto if they exist, or remove them to rely on viewBox
            cleaned = cleaned.replace(/<svg([^>]*)>/i, (match, attributes) => {
                let enhanced = attributes;
                
                // If it doesn't have an overflow style, add it
                if (!enhanced.includes("style=")) {
                    enhanced += ' style="overflow: visible; width: 100%; height: auto; max-height: 70vh;"';
                } else if (!enhanced.includes("overflow: visible")) {
                    enhanced = enhanced.replace(/style="([^"]*)"/i, 'style="$1; overflow: visible; width: 100%; height: auto; max-height: 70vh;"');
                }

                // Ensure it's not strictly sized
                enhanced = enhanced.replace(/width="[^"]*"/gi, 'width="100%"');
                enhanced = enhanced.replace(/height="[^"]*"/gi, 'height="auto"');

                return `<svg${enhanced}>`;
            });

            // Ensure it has a viewBox if it's missing (fallback)
            if (!cleaned.includes("viewBox")) {
                cleaned = cleaned.replace("<svg", '<svg viewBox="0 0 800 400"');
            }
        }
        return cleaned;
    }, [svg, isStreaming]);

    const animateSvg = (container: HTMLElement) => {
        const svgElement = container.querySelector("svg");
        if (!svgElement) return;

        // Animate paths (drawing effect)
        const paths = svgElement.querySelectorAll("path");
        paths.forEach((path: any, i) => {
            try {
                const length = path.getTotalLength();
                if (length < 2) return;
                path.style.strokeDasharray = `${length}`;
                path.style.strokeDashoffset = `${length}`;
                path.animate([
                    { strokeDashoffset: length },
                    { strokeDashoffset: 0 }
                ], {
                    duration: 1000 + (length / 5),
                    delay: i * 150,
                    fill: "forwards",
                    easing: "cubic-bezier(0.4, 0, 0.2, 1)"
                });
            } catch (e) {
                path.style.opacity = "0";
                path.animate([{ opacity: 0 }, { opacity: 1 }], {
                    duration: 500,
                    delay: i * 100,
                    fill: "forwards"
                });
            }
        });

        // Animate other shapes (fade + scale)
        const shapes = svgElement.querySelectorAll("circle, rect, ellipse, polygon, polyline");
        shapes.forEach((shape: any, i) => {
            if (shape.tagName.toLowerCase() === "path") return;
            shape.style.opacity = "0";
            shape.style.transformOrigin = "center";
            shape.style.transform = "scale(0.8)";
            shape.animate([
                { opacity: 0, transform: "scale(0.8)" },
                { opacity: 1, transform: "scale(1)" }
            ], {
                duration: 600,
                delay: i * 80 + 200,
                fill: "forwards",
                easing: "cubic-bezier(0.34, 1.56, 0.64, 1)"
            });
        });

        // Animate text
        const texts = svgElement.querySelectorAll("text");
        texts.forEach((text: any, i) => {
            text.style.opacity = "0";
            text.animate([
                { opacity: 0, transform: "translateY(5px)" },
                { opacity: 1, transform: "translateY(0)" }
            ], {
                duration: 400,
                delay: i * 50 + 500,
                fill: "forwards",
                easing: "ease-out"
            });
        });
    };

    useEffect(() => {
        if (!containerRef.current || isStreaming || hasAnimated) return;
        animateSvg(containerRef.current);
        setHasAnimated(true);
    }, [cleanSvg, isStreaming, hasAnimated]);

    // Animate when modal opens
    useEffect(() => {
        if (isModalOpen && modalRef.current) {
            // Small delay to let modal transition finish
            const timer = setTimeout(() => {
                if (modalRef.current) animateSvg(modalRef.current);
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [isModalOpen]);

    const exportToPNG = async (e?: React.MouseEvent) => {
        e?.stopPropagation();
        const element = isModalOpen ? modalRef.current : containerRef.current;
        if (!element) return;

        try {
            const canvas = await html2canvas(element, {
                backgroundColor: "#18181b", // zinc-900
                scale: 2,
            });

            const link = document.createElement("a");
            link.download = `animated-diagram-${Date.now()}.png`;
            link.href = canvas.toDataURL();
            link.click();
            toast.success("Diagram exported successfully!");
        } catch (error) {
            console.error("Export failed:", error);
            toast.error("Failed to export diagram");
        }
    };

    return (
        <>
            <div
                className={`my-8 group relative ${isStreaming ? "cursor-default" : "cursor-zoom-in"}`}
                onClick={() => {
                    if (!isStreaming) {
                        setIsModalOpen(true);
                    }
                }}
            >
                <div
                    ref={containerRef}
                    className={`overflow-hidden bg-zinc-950/40 p-4 md:p-8 rounded-2xl border border-white/5 hover:border-white/10 transition-all flex justify-center items-center ${isStreaming ? "opacity-90" : ""}`}
                    dangerouslySetInnerHTML={{ __html: cleanSvg }}
                />

                {/* Overlay controls */}
                {!isStreaming && (
                    <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0">
                        <button
                            onClick={exportToPNG}
                            className="p-2 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg backdrop-blur-md border border-white/10 shadow-xl"
                            title="Export as PNG"
                        >
                            <Download className="w-4 h-4" />
                        </button>
                        <button
                            className="p-2 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg backdrop-blur-md border border-white/10 shadow-xl"
                            title="View Fullscreen"
                        >
                            <Maximize2 className="w-4 h-4" />
                        </button>
                    </div>
                )}

                {isStreaming && (
                    <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-full border border-white/10 z-10 shadow-lg">
                        <Sparkles className="w-3.5 h-3.5 animate-pulse text-blue-400" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                            Streaming Visual...
                        </span>
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
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-xl p-4 md:p-8"
                        onClick={() => setIsModalOpen(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="relative w-full max-w-[90vw] max-h-[90vh] bg-zinc-900/90 rounded-3xl border border-white/10 shadow-[0_0_50px_-12px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Header */}
                            <div className="flex items-center justify-between p-6 border-b border-white/5 bg-zinc-900/50 backdrop-blur-md">
                                <div className="flex flex-col">
                                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                                        <ZoomIn className="w-5 h-5 text-blue-400" />
                                        Animated SVG Visualization
                                    </h3>
                                    <p className="text-xs text-zinc-500 mt-1">Interactive architectural explanation</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (modalRef.current) animateSvg(modalRef.current);
                                        }}
                                        className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-zinc-300 hover:text-white transition-all border border-white/10"
                                        title="Re-run animation"
                                    >
                                        <Sparkles className="w-4 h-4 text-purple-400" />
                                        <span className="text-sm font-medium">Re-animate</span>
                                    </button>
                                    <button
                                        onClick={exportToPNG}
                                        className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-zinc-300 hover:text-white transition-all border border-white/10"
                                    >
                                        <Download className="w-4 h-4" />
                                        <span className="text-sm font-medium">Export</span>
                                    </button>
                                    <button
                                        onClick={() => setIsModalOpen(false)}
                                        className="p-2 hover:bg-white/10 rounded-xl text-zinc-400 hover:text-white transition-colors"
                                    >
                                        <X className="w-6 h-6" />
                                    </button>
                                </div>
                            </div>

                            {/* Content */}
                            <div className="flex-1 overflow-auto bg-zinc-950/30 relative custom-scrollbar flex items-center justify-center p-8 md:p-16">
                                <div 
                                    ref={modalRef}
                                    className="relative transition-transform duration-500 hover:scale-[1.02]"
                                    dangerouslySetInnerHTML={{ __html: cleanSvg }}
                                    style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
                                />
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
};
