"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import mermaid from "mermaid";
import {
    validateMermaidSyntax,
    sanitizeMermaidCode,
    compileMermaidFromJSON,
    getCanonicalMermaidDeclaration,
    isSupportedMermaidVisualCode,
} from "@/lib/diagram-utils";
import { Download, X, Maximize2, ZoomIn, Sparkles, Copy, FileCode, Eye } from "lucide-react";
import { toast } from "sonner";
import html2canvas from "html2canvas-pro";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import { initMermaid } from "@/lib/mermaid-init";
import { APP_FONT_STACK } from "@/lib/design-tokens";
import { ensureMermaidMinimumDetail } from "@/lib/diagram-utils";
import { resolveRouteBeadCount, shouldAnimateDedicatedPreview, shouldEnableLoopingBeads } from "@/lib/mermaid-animation";
import { pickContrastingTextColor } from "@/lib/color-contrast";

// Initialize mermaid once
initMermaid();

interface MermaidProps {
    chart: string;
    isStreaming?: boolean;
    rawCode?: string;
}

const MAX_ANIMATED_PATHS = 24;
const MAX_ANIMATED_NODES = 24;
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const SUPPORTED_MERMAID_TYPES_LABEL = "flowchart, sequenceDiagram, stateDiagram-v2, classDiagram, erDiagram, mindmap, gantt, xychart";
const MINDMAP_BRANCH_COLORS = [
    { fillVar: "--mindmap-branch-1-fill", strokeVar: "--mindmap-branch-1-stroke", fallbackFill: "#1d4ed8", fallbackStroke: "#60a5fa" },
    { fillVar: "--mindmap-branch-2-fill", strokeVar: "--mindmap-branch-2-stroke", fallbackFill: "#0e7490", fallbackStroke: "#67e8f9" },
    { fillVar: "--mindmap-branch-3-fill", strokeVar: "--mindmap-branch-3-stroke", fallbackFill: "#047857", fallbackStroke: "#6ee7b7" },
    { fillVar: "--mindmap-branch-4-fill", strokeVar: "--mindmap-branch-4-stroke", fallbackFill: "#6d28d9", fallbackStroke: "#c4b5fd" },
    { fillVar: "--mindmap-branch-5-fill", strokeVar: "--mindmap-branch-5-stroke", fallbackFill: "#b45309", fallbackStroke: "#fcd34d" },
    { fillVar: "--mindmap-branch-6-fill", strokeVar: "--mindmap-branch-6-stroke", fallbackFill: "#be185d", fallbackStroke: "#f9a8d4" },
] as const;
const MINDMAP_SECTION_PATTERN = /^section-(-?\d+)$/;
const MINDMAP_EDGE_SECTION_PATTERN = /^section-edge-(-?\d+)$/;
const MINDMAP_EDGE_SELECTOR = "[class*='section-edge-'], g.edge, path.edge, line.edge, polyline.edge";
const MINDMAP_BLACK_COLOR_TOKENS = new Set([
    "#000",
    "#000000",
    "black",
    "rgb(0,0,0)",
    "rgba(0,0,0,1)",
    "rgba(0,0,0,1.0)",
    "hsl(0,0%,0%)",
    "hsla(0,0%,0%,1)",
    "hsla(0,0%,0%,1.0)",
]);
const MINDMAP_EDGE_STROKE_WIDTH = "1.5";
const MINDMAP_EDGE_TRIM_PX = 10;

function resolveThemeVar(variable: string, fallback: string): string {
    if (typeof window === "undefined") {
        return fallback;
    }
    const value = window.getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
    return value || fallback;
}

function extractErrorMessage(error: unknown): string {
    if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
        return (error as { message: string }).message;
    }
    return "Failed to process diagram";
}

function prefersReducedMotion(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return false;
    }
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

async function requestFixedMermaidCode(code: string, timeoutMs = 30000): Promise<string | null> {
    if (typeof window === "undefined") {
        return null;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch('/api/fix-mermaid', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
            signal: controller.signal,
        });

        if (!response.ok) {
            return null;
        }

        const payload = await response.json() as { fixed?: unknown };
        return typeof payload.fixed === "string" && payload.fixed.trim().length > 0 ? payload.fixed : null;
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            console.warn("Mermaid fix request timed out");
            return null;
        }
        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
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
function normalizeMermaidSvg(svgString: string, chartSource = ""): string {
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
        svgEl.style.overflow = 'hidden';
        svgEl.style.maxWidth = '100%';
        svgEl.style.maxHeight = '100%';
        svgEl.style.fontFamily = APP_FONT_STACK;
        svgEl.style.backgroundColor = 'transparent';
        applyDiagramThemeOverrides(svgEl, chartSource);

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
    svgElement.style.overflow = 'hidden';
    svgElement.style.maxWidth = '100%';
    svgElement.style.maxHeight = '100%';
    svgElement.style.fontFamily = APP_FONT_STACK;
    svgElement.style.backgroundColor = 'transparent';
}

function resetAnimatedSvgStyles(svgElement: SVGSVGElement): void {
    const animatedElements = svgElement.querySelectorAll<SVGElement>(".node, .actor, .state, .class-name, path");
    animatedElements.forEach((element) => {
        element.getAnimations?.().forEach((animation) => animation.cancel());
    });

    svgElement.querySelectorAll("[data-rm-beads]").forEach((node) => node.remove());

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

function normalizeColorToken(color: string): string {
    return color.replace(/\s+/g, "").toLowerCase();
}

function isMindmapBlackColor(color: string): boolean {
    return MINDMAP_BLACK_COLOR_TOKENS.has(normalizeColorToken(color));
}

function resolveMindmapPalette(): string[] {
    const fallbackPalette = MINDMAP_BRANCH_COLORS.map((entry) => entry.fallbackStroke);
    const resolvedPalette = MINDMAP_BRANCH_COLORS.map((entry, index) => {
        const resolved = resolveThemeVar(entry.strokeVar, fallbackPalette[index] ?? "#60a5fa");
        return isMindmapBlackColor(resolved) ? (fallbackPalette[index] ?? "#60a5fa") : resolved;
    });

    for (let index = 1; index < resolvedPalette.length; index += 1) {
        const current = normalizeColorToken(resolvedPalette[index] ?? "");
        const previous = normalizeColorToken(resolvedPalette[index - 1] ?? "");
        if (!current || current !== previous) continue;

        const replacement = resolvedPalette.find((candidate, candidateIndex) => {
            if (candidateIndex === index) return false;
            const normalized = normalizeColorToken(candidate ?? "");
            return normalized.length > 0 && normalized !== previous && !isMindmapBlackColor(candidate ?? "");
        }) ?? fallbackPalette.find((candidate) => normalizeColorToken(candidate) !== previous);

        if (replacement) {
            resolvedPalette[index] = replacement;
        }
    }

    return resolvedPalette;
}

function getMindmapSectionFromClassList(classList: DOMTokenList): number | null {
    for (const className of Array.from(classList)) {
        const match = MINDMAP_EDGE_SECTION_PATTERN.exec(className) ?? MINDMAP_SECTION_PATTERN.exec(className);
        if (!match) continue;
        const section = Number.parseInt(match[1], 10);
        if (!Number.isFinite(section) || section < 0) {
            return 0;
        }
        return section;
    }
    return null;
}

function getMindmapSectionForElement(element: Element): number {
    let current: Element | null = element;
    while (current) {
        const section = getMindmapSectionFromClassList(current.classList);
        if (section !== null) {
            return section;
        }
        current = current.parentElement;
    }
    return 0;
}

function getMindmapNodeCenter(node: SVGGElement): { x: number; y: number } {
    try {
        const box = node.getBBox();
        return { x: box.x + (box.width / 2), y: box.y + (box.height / 2) };
    } catch {
        return { x: 0, y: 0 };
    }
}

function getSvgCenter(svgElement: SVGSVGElement): { x: number; y: number } {
    const viewBox = svgElement.viewBox?.baseVal;
    if (viewBox && Number.isFinite(viewBox.width) && Number.isFinite(viewBox.height) && viewBox.width > 0 && viewBox.height > 0) {
        return { x: viewBox.x + (viewBox.width / 2), y: viewBox.y + (viewBox.height / 2) };
    }

    const width = Number.parseFloat(svgElement.getAttribute("width") ?? "");
    const height = Number.parseFloat(svgElement.getAttribute("height") ?? "");
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
        return { x: width / 2, y: height / 2 };
    }

    return { x: 0, y: 0 };
}

function squaredDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return (dx * dx) + (dy * dy);
}

type MindmapNodeTier = "root" | "category" | "leaf";

interface MindmapNodeMeta {
    node: SVGGElement;
    center: { x: number; y: number };
    box: { x: number; y: number; width: number; height: number };
    section: number;
    tier: MindmapNodeTier;
}

function getMindmapNodeBox(node: SVGGElement): { x: number; y: number; width: number; height: number } {
    try {
        const box = node.getBBox();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
    } catch {
        return { x: 0, y: 0, width: 0, height: 0 };
    }
}

function classifyMindmapNodeTiers(svgElement: SVGSVGElement): MindmapNodeMeta[] {
    const nodes = Array.from(svgElement.querySelectorAll<SVGGElement>("g.mindmap-node"));
    if (nodes.length === 0) return [];

    const metas = nodes.map((node) => {
        const box = getMindmapNodeBox(node);
        const center = box.width > 0 || box.height > 0
            ? { x: box.x + (box.width / 2), y: box.y + (box.height / 2) }
            : getMindmapNodeCenter(node);
        return {
            node,
            box,
            center,
            section: getMindmapSectionForElement(node),
            tier: "leaf" as MindmapNodeTier,
        };
    });

    const svgCenter = getSvgCenter(svgElement);
    let rootMeta = metas[0];
    for (const meta of metas) {
        if (squaredDistance(meta.center, svgCenter) < squaredDistance(rootMeta.center, svgCenter)) {
            rootMeta = meta;
        }
    }
    rootMeta.tier = "root";

    const bySection = new Map<number, MindmapNodeMeta[]>();
    for (const meta of metas) {
        if (meta === rootMeta) continue;
        const bucket = bySection.get(meta.section) ?? [];
        bucket.push(meta);
        bySection.set(meta.section, bucket);
    }

    bySection.forEach((sectionNodes) => {
        let nearest = sectionNodes[0];
        for (const candidate of sectionNodes) {
            if (squaredDistance(candidate.center, rootMeta.center) < squaredDistance(nearest.center, rootMeta.center)) {
                nearest = candidate;
            }
        }
        nearest.tier = "category";
    });

    return metas;
}

function distancePointToNodeBox(point: { x: number; y: number }, box: { x: number; y: number; width: number; height: number }): number {
    if (box.width <= 0 || box.height <= 0) {
        return Number.POSITIVE_INFINITY;
    }
    const clampedX = Math.max(box.x, Math.min(point.x, box.x + box.width));
    const clampedY = Math.max(box.y, Math.min(point.y, box.y + box.height));
    return Math.hypot(point.x - clampedX, point.y - clampedY);
}

function findNearestMindmapNodeMeta(point: { x: number; y: number }, nodes: MindmapNodeMeta[]): MindmapNodeMeta | null {
    let nearest: MindmapNodeMeta | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const node of nodes) {
        const distance = distancePointToNodeBox(point, node.box);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = node;
        }
    }

    return nearest;
}

function parseSvgPolylinePoints(value: string): Array<{ x: number; y: number }> {
    return value
        .trim()
        .split(/\s+/)
        .map((point) => {
            const [x, y] = point.split(",").map((part) => Number.parseFloat(part));
            return { x, y };
        })
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function resolveEdgeGeometryElement(edgeElement: SVGElement): SVGElement | null {
    const tag = edgeElement.tagName.toLowerCase();
    if (tag === "path" || tag === "line" || tag === "polyline") {
        return edgeElement;
    }
    return edgeElement.querySelector<SVGElement>("path, line, polyline");
}

function getEdgeTerminalPoint(edgeElement: SVGElement, terminal: "start" | "end"): { x: number; y: number } | null {
    const geometry = resolveEdgeGeometryElement(edgeElement);
    if (!geometry) return null;

    const tag = geometry.tagName.toLowerCase();
    if (tag === "line") {
        const x = Number.parseFloat(geometry.getAttribute(terminal === "start" ? "x1" : "x2") ?? "");
        const y = Number.parseFloat(geometry.getAttribute(terminal === "start" ? "y1" : "y2") ?? "");
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x, y };
    }

    if (tag === "polyline") {
        const points = parseSvgPolylinePoints(geometry.getAttribute("points") ?? "");
        if (points.length === 0) return null;
        return terminal === "start" ? points[0] ?? null : points[points.length - 1] ?? null;
    }

    if (tag === "path") {
        const path = geometry as SVGPathElement;
        try {
            const totalLength = path.getTotalLength();
            if (!Number.isFinite(totalLength) || totalLength <= 0) return null;
            const distance = terminal === "start" ? 0 : totalLength;
            const point = path.getPointAtLength(distance);
            return { x: point.x, y: point.y };
        } catch {
            return null;
        }
    }

    return null;
}

function resolveMindmapEdgeColor(
    edgeElement: SVGElement,
    nodeMetaList: MindmapNodeMeta[],
    sectionColor: string,
    rootEdgeColor: string,
    categoryEdgeColor: string
): string {
    const startPoint = getEdgeTerminalPoint(edgeElement, "start");
    if (!startPoint) return sectionColor;
    const sourceNode = findNearestMindmapNodeMeta(startPoint, nodeMetaList);
    if (!sourceNode) return sectionColor;
    if (sourceNode.tier === "root") {
        return rootEdgeColor;
    }
    if (sourceNode.tier === "category") {
        return categoryEdgeColor;
    }
    return sectionColor;
}

function elevateMindmapNodesAboveEdges(svgElement: SVGSVGElement): void {
    const mindmapNodes = Array.from(svgElement.querySelectorAll<SVGGElement>("g.mindmap-node"));
    const parentBuckets = new Map<Element, SVGGElement[]>();

    mindmapNodes.forEach((node) => {
        const parent = node.parentElement;
        if (!parent) return;
        const bucket = parentBuckets.get(parent) ?? [];
        bucket.push(node);
        parentBuckets.set(parent, bucket);
    });

    parentBuckets.forEach((nodes, parent) => {
        nodes.forEach((node) => {
            parent.appendChild(node);
        });
    });
}

function applyMindmapEdgeGeometryTrim(edgeElement: SVGElement, trimPx: number): void {
    const tag = edgeElement.tagName.toLowerCase();
    if (tag === "line") {
        const x1 = Number.parseFloat(edgeElement.getAttribute("x1") ?? "");
        const y1 = Number.parseFloat(edgeElement.getAttribute("y1") ?? "");
        const x2 = Number.parseFloat(edgeElement.getAttribute("x2") ?? "");
        const y2 = Number.parseFloat(edgeElement.getAttribute("y2") ?? "");
        if ([x1, y1, x2, y2].some((value) => !Number.isFinite(value))) return;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.hypot(dx, dy);
        if (!Number.isFinite(length) || length <= 0) return;
        const appliedTrim = Math.min(trimPx, (length / 2) - 0.5);
        if (appliedTrim <= 0) return;
        const ux = dx / length;
        const uy = dy / length;
        edgeElement.setAttribute("x1", String(x1 + (ux * appliedTrim)));
        edgeElement.setAttribute("y1", String(y1 + (uy * appliedTrim)));
        edgeElement.setAttribute("x2", String(x2 - (ux * appliedTrim)));
        edgeElement.setAttribute("y2", String(y2 - (uy * appliedTrim)));
        return;
    }

    if (tag === "polyline") {
        const rawPoints = edgeElement.getAttribute("points") ?? "";
        const parsedPoints = parseSvgPolylinePoints(rawPoints);

        if (parsedPoints.length < 2) return;

        const first = parsedPoints[0];
        const second = parsedPoints[1];
        const penultimate = parsedPoints[parsedPoints.length - 2];
        const last = parsedPoints[parsedPoints.length - 1];
        if (!first || !second || !penultimate || !last) return;

        const trimEndpoint = (from: { x: number; y: number }, toward: { x: number; y: number }) => {
            const dx = toward.x - from.x;
            const dy = toward.y - from.y;
            const length = Math.hypot(dx, dy);
            if (!Number.isFinite(length) || length <= 0) return from;
            const appliedTrim = Math.min(trimPx, (length / 2) - 0.5);
            if (appliedTrim <= 0) return from;
            const ux = dx / length;
            const uy = dy / length;
            return { x: from.x + (ux * appliedTrim), y: from.y + (uy * appliedTrim) };
        };

        parsedPoints[0] = trimEndpoint(first, second);
        parsedPoints[parsedPoints.length - 1] = trimEndpoint(last, penultimate);

        edgeElement.setAttribute("points", parsedPoints.map((point) => `${point.x},${point.y}`).join(" "));
        return;
    }

    if (tag === "path") {
        const path = edgeElement as SVGPathElement;
        try {
            const rawPath = path.getAttribute("d") ?? "";
            const isSingleStraightSegment = /^\s*[Mm][^A-Za-z]*[Ll][^A-Za-z]*\s*$/.test(rawPath);
            if (!isSingleStraightSegment) return;

            const totalLength = path.getTotalLength();
            if (!Number.isFinite(totalLength) || totalLength <= 0) return;
            const appliedTrim = Math.min(trimPx, (totalLength / 2) - 0.5);
            if (appliedTrim <= 0) return;
            const start = path.getPointAtLength(appliedTrim);
            const end = path.getPointAtLength(totalLength - appliedTrim);
            path.setAttribute("d", `M ${start.x} ${start.y} L ${end.x} ${end.y}`);
        } catch {
            // If the browser cannot resolve path length for this edge, keep original geometry.
        }
    }
}

function resolveMindmapBranchTextColor(backgroundColor: string): string {
    const darkText = resolveThemeVar("--mindmap-branch-text-dark", "#0f172a");
    const lightText = resolveThemeVar("--mindmap-branch-text-light", "#f8fafc");
    return pickContrastingTextColor(backgroundColor, darkText, lightText);
}

function applyMindmapThemeOverrides(svgElement: SVGSVGElement): void {
    const palette = resolveMindmapPalette();
    const centerFill = resolveThemeVar("--mindmap-center-fill", "#4f46e5");
    const centerStroke = resolveThemeVar("--mindmap-center-stroke", "#4338ca");
    const centerText = resolveThemeVar("--mindmap-center-text", "#f8fafc");
    const categoryFill = resolveThemeVar("--mindmap-category-fill", "#1f2937");
    const categoryStroke = resolveThemeVar("--mindmap-category-stroke", "#475569");
    const categoryText = resolveThemeVar("--mindmap-category-text", "#e2e8f0");
    const sectionOrder = new Map<number, number>();
    const getSectionColor = (section: number): string => {
        if (!sectionOrder.has(section)) {
            sectionOrder.set(section, sectionOrder.size);
        }
        const paletteIndex = sectionOrder.get(section) ?? 0;
        const color = palette[paletteIndex % palette.length];
        return color ?? palette[0] ?? "#60a5fa";
    };

    elevateMindmapNodesAboveEdges(svgElement);
    const nodeMetaList = classifyMindmapNodeTiers(svgElement);
    const nodeMetaByElement = new Map(nodeMetaList.map((meta) => [meta.node, meta]));

    nodeMetaList.forEach((meta) => {
        const { node, section, tier } = meta;
        const sectionColor = getSectionColor(section);
        const leafTextColor = resolveMindmapBranchTextColor(sectionColor);
        const nodeFill = tier === "root" ? centerFill : tier === "category" ? categoryFill : sectionColor;
        const nodeStroke = tier === "root" ? centerStroke : tier === "category" ? categoryStroke : sectionColor;
        const nodeTextColor = tier === "root" ? centerText : tier === "category" ? categoryText : leafTextColor;
        const nodeStrokeWidth = tier === "root" ? "2.5" : tier === "category" ? "2" : "1.75";

        const nodeBodies = node.querySelectorAll<SVGElement>(".label-container, .node-bkg, rect, polygon, circle, ellipse");
        nodeBodies.forEach((shape) => {
            shape.style.setProperty("fill", nodeFill, "important");
            shape.style.setProperty("fill-opacity", "1", "important");
            shape.style.setProperty("stroke", nodeStroke, "important");
            shape.style.setProperty("stroke-width", nodeStrokeWidth, "important");

            if (tier === "category" && shape.tagName.toLowerCase() === "rect") {
                shape.setAttribute("rx", "8");
                shape.setAttribute("ry", "8");
            }
        });

        const nodeLines = node.querySelectorAll<SVGElement>("line, polyline, path");
        nodeLines.forEach((line) => {
            line.style.setProperty("stroke", nodeStroke, "important");
            line.style.setProperty("stroke-width", nodeStrokeWidth, "important");
        });

        const nodeTextElements = node.querySelectorAll<SVGTextElement>("text");
        nodeTextElements.forEach((textElement) => {
            textElement.style.setProperty("fill", nodeTextColor, "important");
        });
    });

    const edgeElements = svgElement.querySelectorAll<SVGElement>(MINDMAP_EDGE_SELECTOR);
    edgeElements.forEach((edge) => {
        const section = getMindmapSectionForElement(edge);
        const sectionColor = getSectionColor(section);
        const edgeColor = resolveMindmapEdgeColor(edge, nodeMetaList, sectionColor, centerStroke, categoryStroke);

        edge.style.setProperty("stroke", edgeColor, "important");
        edge.style.setProperty("stroke-width", MINDMAP_EDGE_STROKE_WIDTH, "important");
        edge.style.setProperty("stroke-linecap", "round", "important");
        edge.style.setProperty("stroke-linejoin", "round", "important");
        edge.style.setProperty("filter", "none", "important");
        edge.style.setProperty("opacity", "1", "important");
        if (edge.tagName.toLowerCase() !== "g") {
            edge.style.setProperty("fill", "none", "important");
        }

        const edgePaths = edge.querySelectorAll<SVGElement>("path, line, polyline, polygon");
        edgePaths.forEach((edgePath) => {
            edgePath.style.setProperty("stroke", edgeColor, "important");
            edgePath.style.setProperty("fill", "none", "important");
            edgePath.style.setProperty("stroke-width", MINDMAP_EDGE_STROKE_WIDTH, "important");
            edgePath.style.setProperty("stroke-linecap", "round", "important");
            edgePath.style.setProperty("stroke-linejoin", "round", "important");
            edgePath.style.setProperty("filter", "none", "important");
            applyMindmapEdgeGeometryTrim(edgePath, MINDMAP_EDGE_TRIM_PX);
        });

        applyMindmapEdgeGeometryTrim(edge, MINDMAP_EDGE_TRIM_PX);
    });

    const allMindmapText = svgElement.querySelectorAll<SVGTextElement>(".mindmap-node-label, .mindmap-node text");
    allMindmapText.forEach((textElement) => {
        const owningNode = textElement.closest<SVGGElement>("g.mindmap-node");
        const meta = owningNode ? nodeMetaByElement.get(owningNode) : null;
        if (!meta) return;

        if (meta.tier === "root") {
            textElement.style.setProperty("fill", centerText, "important");
            return;
        }
        if (meta.tier === "category") {
            textElement.style.setProperty("fill", categoryText, "important");
            return;
        }

        const sectionColor = getSectionColor(meta.section);
        textElement.style.setProperty("fill", resolveMindmapBranchTextColor(sectionColor), "important");
    });
}

function applyXyChartThemeOverrides(svgElement: SVGSVGElement): void {
    const textColor = resolveThemeVar("--xychart-text", "#e5e7eb");
    const axisColor = resolveThemeVar("--xychart-axis", "#6b7280");
    const barColor = resolveThemeVar("--xychart-bar", "#60a5fa");
    const lineColor = resolveThemeVar("--xychart-line", "#34d399");

    const mainGroup = svgElement.querySelector<SVGGElement>("g.main");
    if (!mainGroup) return;

    const background = mainGroup.querySelector<SVGRectElement>("rect.background");
    if (background) {
        background.setAttribute("fill", "transparent");
        background.setAttribute("opacity", "0");
        background.style.setProperty("fill", "transparent", "important");
        background.style.setProperty("opacity", "0", "important");
    }

    const allText = mainGroup.querySelectorAll<SVGTextElement>("text");
    allText.forEach((textNode) => {
        textNode.style.setProperty("fill", textColor, "important");
    });

    const axisPaths = mainGroup.querySelectorAll<SVGPathElement>(
        "g.left-axis path, g.bottom-axis path, g.top-axis path"
    );
    axisPaths.forEach((path) => {
        path.style.setProperty("stroke", axisColor, "important");
    });

    const bars = mainGroup.querySelectorAll<SVGRectElement>("g.plot g[class^='bar-plot-'] rect");
    bars.forEach((bar) => {
        bar.style.setProperty("fill", barColor, "important");
        bar.style.setProperty("stroke", barColor, "important");
    });

    const barLabels = mainGroup.querySelectorAll<SVGTextElement>("g.plot g[class^='bar-plot-'] text");
    barLabels.forEach((label) => {
        label.style.setProperty("fill", textColor, "important");
    });

    const lines = mainGroup.querySelectorAll<SVGPathElement>("g.plot g[class^='line-plot-'] path");
    lines.forEach((line) => {
        line.style.setProperty("stroke", lineColor, "important");
        line.style.setProperty("fill", "none", "important");
    });
}

function applyDiagramThemeOverrides(svgElement: SVGSVGElement, chartSource: string): void {
    const declaration = getCanonicalMermaidDeclaration(chartSource ?? "");
    if (declaration === "mindmap") {
        applyMindmapThemeOverrides(svgElement);
        return;
    }
    if (declaration === "xychart") {
        applyXyChartThemeOverrides(svgElement);
    }
}

function addRouteBeads(svgElement: SVGSVGElement, routePaths: SVGPathElement[], chart: string): void {
    // Animate one bead per connection path so direction is visible on every line.
    const beadCount = resolveRouteBeadCount(chart, routePaths.length, routePaths.length);
    if (beadCount <= 0) return;

    const layer = document.createElementNS(SVG_NS, "g");
    layer.setAttribute("data-rm-beads", "true");
    layer.setAttribute("pointer-events", "none");

    for (let index = 0; index < beadCount; index += 1) {
        const path = routePaths[index];
        if (!path) continue;
        const pathId = path.id || `rm-route-${index + 1}`;
        if (!path.id) {
            path.id = pathId;
        }

        const bead = document.createElementNS(SVG_NS, "circle");
        bead.setAttribute("r", "2.6");
        bead.setAttribute("fill", "#60a5fa");
        bead.setAttribute("opacity", "0.8");

        const animateMotion = document.createElementNS(SVG_NS, "animateMotion");
        animateMotion.setAttribute("dur", `${2.1 + (index * 0.3)}s`);
        animateMotion.setAttribute("repeatCount", "indefinite");
        animateMotion.setAttribute("rotate", "auto");

        const mpath = document.createElementNS(SVG_NS, "mpath");
        mpath.setAttribute("href", `#${pathId}`);
        mpath.setAttributeNS(XLINK_NS, "xlink:href", `#${pathId}`);
        animateMotion.appendChild(mpath);
        bead.appendChild(animateMotion);
        layer.appendChild(bead);
    }

    svgElement.appendChild(layer);
}

function runMermaidEntranceAnimations(svgElement: SVGSVGElement, chart: string, enableLoopingBeads: boolean): Animation[] {
    const runningAnimations: Animation[] = [];
    const declaration = getCanonicalMermaidDeclaration(chart ?? "");
    const isMindmap = declaration === "mindmap";

    const routePaths = Array.from(
        svgElement.querySelectorAll<SVGPathElement>("path.edgePath path, path.flowchart-link, .sequence-diagram path, .stateDiagram path")
    );
    const animatedPaths = routePaths.slice(0, MAX_ANIMATED_PATHS);
    animatedPaths.forEach((path, i) => {
        try {
            const length = path.getTotalLength();
            if (length < 5) return;
            const stagger = Math.min(i * 12, 160);
            const animation = path.animate([
                { strokeDasharray: `${length}`, strokeDashoffset: length },
                { strokeDasharray: `${length}`, strokeDashoffset: 0 }
            ], {
                duration: Math.min(680, 280 + (length / 6)),
                delay: stagger,
                fill: "none",
                easing: "ease-out"
            });
            runningAnimations.push(animation);
        } catch {
            // Ignore paths that don't support getTotalLength
        }
    });

    const nodes = Array.from(svgElement.querySelectorAll<SVGElement>(".node, .actor, .state, .class-name")).slice(0, MAX_ANIMATED_NODES);
    nodes.forEach((node, i) => {
        const stagger = Math.min(i * 10, 120);
        const keyframes = isMindmap
            ? [
                { opacity: 0, transform: "scale(0.82)" },
                { opacity: 1, transform: "scale(1.06)" },
                { opacity: 1, transform: "scale(1)" },
            ]
            : [
                { opacity: 0 },
                { opacity: 1 },
            ];
        const animation = node.animate(keyframes, {
            duration: isMindmap ? 420 : 240,
            delay: stagger,
            fill: "none",
            easing: isMindmap ? "cubic-bezier(0.2, 1.2, 0.2, 1)" : "ease-out",
        });
        runningAnimations.push(animation);
    });

    if (enableLoopingBeads) {
        addRouteBeads(svgElement, routePaths, chart);
    }

    return runningAnimations;
}


export const Mermaid = ({ chart, isStreaming = false, rawCode }: MermaidProps) => {
    const [svg, setSvg] = useState<string>("");
    const [renderedChart, setRenderedChart] = useState<string>("");
    const [isBrowser, setIsBrowser] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isFixing, setIsFixing] = useState(false);
    const [isRawView, setIsRawView] = useState(false);
    const [copiedRaw, setCopiedRaw] = useState(false);
    const diagramRef = useRef<HTMLDivElement>(null);
    const modalRef = useRef<HTMLDivElement>(null);
    const lastAnimatedSvgRef = useRef("");
    const streamAnimationPlayedRef = useRef(false);
    const prevStreamingRef = useRef(isStreaming);
    const isGenerating = isFixing || isStreaming;
    const isUnsupportedTypeError = Boolean(error && error.startsWith("Unsupported Mermaid diagram type"));
    // During streaming, we don't want to show the full-screen blurring overlay because it makes it
    // look like the UI is blocked. Only show it if we are fixing the diagram or if we have no SVG at all
    // and are NOT in the middle of a stream (i.e. first render or explicit generation).
    const showOverlay = !svg && (isFixing || isGenerating);
    const activeMermaidSource = useMemo(() => {
        if (rawCode && rawCode.trim().length > 0) {
            return rawCode;
        }
        return renderedChart || chart || "";
    }, [rawCode, renderedChart, chart]);

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
    const fixedCacheKey = useMemo(() => `repomind:fixed-mermaid:${id}`, [id]);

    useEffect(() => {
        setIsBrowser(true);
    }, []);

    useEffect(() => {
        if (!chart) return;

        // Each render attempt has its own "generation" counter so that a stale
        // async result from a previous chart/id does not overwrite a newer one.
        let mounted = true;

        const renderDiagram = async (retryCount = 0) => {
            try {
                let persistedFixedCode: string | null = null;
                if (typeof window !== "undefined") {
                    try {
                        const cached = window.localStorage.getItem(fixedCacheKey);
                        if (cached && cached.trim().length > 0) {
                            persistedFixedCode = cached;
                        }
                    } catch {
                        // Ignore localStorage read issues.
                    }
                }

                let codeToRender = persistedFixedCode ?? chart;
                let isTypedMermaidJson = false;

                // Check if the content is JSON (starts with {)
                // This handles cases where the LLM uses ```mermaid for JSON content
                if (!persistedFixedCode && codeToRender.trim().startsWith('{')) {
                    try {
                        console.log('🔍 Detected JSON content in Mermaid block, converting...');
                        const data = JSON.parse(codeToRender);
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
                const declaration = getCanonicalMermaidDeclaration(sanitized);

                if (declaration && !isSupportedMermaidVisualCode(sanitized)) {
                    if (isStreaming) {
                        return;
                    }
                    if (mounted) {
                        setIsFixing(false);
                        setError(`Unsupported Mermaid diagram type "${declaration}". Supported types: ${SUPPORTED_MERMAID_TYPES_LABEL}.`);
                    }
                    return;
                }

                if (!validation.valid) {
                    console.warn('⚠️ Validation warning:', validation.error);
                }

                // Try rendering with sanitized code
                try {
                    const { svg: newSvg } = await mermaid.render(id, sanitized);
                    if (mounted) {
                        setSvg(normalizeMermaidSvg(newSvg, sanitized));
                        setRenderedChart(sanitized);
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
                            const fixed = await requestFixedMermaidCode(sanitized);

                            if (fixed) {
                                console.log('✅ AI Fix received, retrying render...');
                                const { svg: fixedSvg } = await mermaid.render(id + '-autofixed', fixed);
                                if (mounted) {
                                    setSvg(normalizeMermaidSvg(fixedSvg, fixed));
                                    setRenderedChart(fixed);
                                    setError(null);
                                    setIsFixing(false);
                                    if (typeof window !== "undefined") {
                                        try {
                                            window.localStorage.setItem(fixedCacheKey, fixed);
                                        } catch {
                                            // Ignore localStorage write issues.
                                        }
                                    }
                                }
                                return;
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
    }, [chart, id, isStreaming, fixedCacheKey]);

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
                    setSvg(normalizeMermaidSvg(svg, codeToRender));
                    setRenderedChart(codeToRender);
                    setError(null);
                    if (typeof window !== "undefined") {
                        try {
                            window.localStorage.setItem(fixedCacheKey, codeToRender);
                        } catch {
                            // Ignore localStorage write issues.
                        }
                    }
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
            const declaration = getCanonicalMermaidDeclaration(sanitized);

            if (declaration && !isSupportedMermaidVisualCode(sanitized)) {
                setError(`Unsupported Mermaid diagram type "${declaration}". Supported types: ${SUPPORTED_MERMAID_TYPES_LABEL}.`);
                return;
            }

            const fixed = await requestFixedMermaidCode(sanitized);

            if (fixed) {
                const { svg } = await mermaid.render(id + '-manualfixed', fixed);
                setSvg(normalizeMermaidSvg(svg, fixed));
                setRenderedChart(fixed);
                setError(null);
                if (typeof window !== "undefined") {
                    try {
                        window.localStorage.setItem(fixedCacheKey, fixed);
                    } catch {
                        // Ignore localStorage write issues.
                    }
                }
                console.log('✅ Layer 3 successful: Manual AI fix worked');
                return;
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
            const animationSource = renderedChart || chart;

            const shouldAnimate =
                isStreaming
                    ? !streamAnimationPlayedRef.current && lastAnimatedSvgRef.current !== svg
                    : !streamAnimationPlayedRef.current && lastAnimatedSvgRef.current !== svg;

            if (!shouldAnimate) {
                applyResponsiveSvgSizing(svgElement);
                resetAnimatedSvgStyles(svgElement);
                applyDiagramThemeOverrides(svgElement, animationSource);
                lastAnimatedSvgRef.current = svg;
                return;
            }

            const reducedMotion = prefersReducedMotion();
            applyResponsiveSvgSizing(svgElement);
            resetAnimatedSvgStyles(svgElement);
            applyDiagramThemeOverrides(svgElement, animationSource);
            if (!reducedMotion) {
                runningAnimations.push(...runMermaidEntranceAnimations(svgElement, animationSource, shouldEnableLoopingBeads(reducedMotion)));
            }

            if (isStreaming) {
                streamAnimationPlayedRef.current = true;
            }
            lastAnimatedSvgRef.current = svg;
        });

        return () => {
            cancelAnimationFrame(raf);
            runningAnimations.forEach((animation) => animation.cancel());
        };
    }, [svg, isStreaming, chart, renderedChart]);

    useEffect(() => {
        if (!isModalOpen || !modalRef.current) return;

        let runningAnimations: Animation[] = [];
        const timer = setTimeout(() => {
            const container = modalRef.current;
            if (!container) return;
            const svgElement = container.querySelector("svg");
            if (!svgElement) return;

            const reducedMotion = prefersReducedMotion();
            const animationSource = renderedChart || chart;
            applyResponsiveSvgSizing(svgElement);
            resetAnimatedSvgStyles(svgElement);
            applyDiagramThemeOverrides(svgElement, animationSource);
            if (shouldAnimateDedicatedPreview(animationSource, reducedMotion)) {
                runningAnimations = runMermaidEntranceAnimations(svgElement, animationSource, shouldEnableLoopingBeads(reducedMotion));
            }
        }, 300);

        return () => {
            clearTimeout(timer);
            runningAnimations.forEach((animation) => animation.cancel());
        };
    }, [isModalOpen, svg, chart, renderedChart]);

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

    const handleCopyRawCode = async (e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (!activeMermaidSource.trim()) {
            toast.error("No Mermaid code to copy");
            return;
        }
        try {
            await navigator.clipboard.writeText(activeMermaidSource);
            setCopiedRaw(true);
            window.setTimeout(() => setCopiedRaw(false), 1800);
            toast.success("Mermaid code copied");
        } catch {
            toast.error("Failed to copy Mermaid code");
        }
    };

    return (
        <>
            <div
                className={`my-4 group relative isolate ${isGenerating || isRawView ? "cursor-default" : "cursor-zoom-in"}`}
                onClick={() => {
                    if (!isGenerating && svg && !isRawView) {
                        setIsModalOpen(true);
                    }
                }}
            >
                {isRawView ? (
                    <div
                        className="overflow-hidden max-h-[80vh] p-2 md:p-4 rounded-lg border border-white/5 hover:border-white/10 transition-colors min-w-0"
                        style={{ minHeight: activeMermaidSource ? 'auto' : '200px' }}
                    >
                        <pre className="m-0 max-h-[72vh] overflow-auto rounded-lg border border-white/10 bg-zinc-950/80 p-4 text-xs leading-relaxed text-zinc-200 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{activeMermaidSource || "No Mermaid code available."}</pre>
                    </div>
                ) : (
                    <div
                        ref={diagramRef}
                        className="diagram-inline-content overflow-hidden max-h-[80vh] p-2 md:p-4 rounded-lg border border-white/5 hover:border-white/10 transition-colors flex items-center justify-center min-w-0"
                        dangerouslySetInnerHTML={{ __html: svg }}
                        style={{ minHeight: svg ? 'auto' : '200px' }}
                    />
                )}
                <style>{`
                    .diagram-inline-content svg {
                        width: auto !important;
                        height: auto !important;
                        max-width: 100% !important;
                        max-height: calc(80vh - 2rem) !important;
                        display: block;
                        margin: 0 auto;
                    }
                    @media (min-width: 768px) {
                        .diagram-inline-content svg {
                            max-height: calc(80vh - 4rem) !important;
                        }
                    }
                `}</style>

                {/* Overlay controls */}
                {!isGenerating && svg && (
                    <div className="absolute top-2 right-2 flex gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsRawView((prev) => !prev);
                            }}
                            className="p-2 bg-zinc-800/85 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg backdrop-blur-sm"
                            title={isRawView ? "Show preview" : "Show raw Mermaid code"}
                        >
                            {isRawView ? <Eye className="w-4 h-4" /> : <FileCode className="w-4 h-4" />}
                        </button>
                        <button
                            onClick={handleCopyRawCode}
                            className="p-2 bg-zinc-800/85 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg backdrop-blur-sm"
                            title="Copy Mermaid code"
                        >
                            <Copy className={`w-4 h-4 ${copiedRaw ? "text-emerald-400" : ""}`} />
                        </button>
                        {!isRawView && (
                            <button
                                onClick={exportToPNG}
                                className="p-2 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white rounded-lg backdrop-blur-sm"
                                title="Export as PNG"
                            >
                                <Download className="w-4 h-4" />
                            </button>
                        )}
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (!isRawView) {
                                    setIsModalOpen(true);
                                }
                            }}
                            className="p-2 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white rounded-lg backdrop-blur-sm"
                            title="View Fullscreen"
                        >
                            <Maximize2 className="w-4 h-4" />
                        </button>
                    </div>
                )}

                {showOverlay && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/55 backdrop-blur-sm rounded-lg z-10">
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
                        {!isUnsupportedTypeError && (
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
                        )}
                    </div>
                )}
            </div>

            {/* Fullscreen Modal */}
            {isBrowser && createPortal(
                <AnimatePresence>
                    {isModalOpen && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-sm p-3 md:p-6"
                            onClick={() => setIsModalOpen(false)}
                        >
                            <motion.div
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                                className="relative isolate w-[min(96vw,1440px)] h-[min(92vh,980px)] rounded-2xl overflow-hidden flex flex-col bg-transparent"
                                onClick={(e) => e.stopPropagation()}
                            >
                                {/* Header */}
                                <div className="flex shrink-0 items-center justify-between p-4 bg-transparent">
                                    <h3 className="text-sm font-medium text-zinc-400 flex items-center gap-2">
                                        <ZoomIn className="w-4 h-4" />
                                        {isRawView ? "Mermaid Raw Code" : "Diagram Preview"}
                                    </h3>
                                    <div className="flex items-center gap-2">
                                        {!isGenerating && svg && (
                                            <>
                                                <button
                                                    onClick={() => setIsRawView((prev) => !prev)}
                                                    className="p-2 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors"
                                                    title={isRawView ? "Show preview" : "Show raw Mermaid code"}
                                                >
                                                    {isRawView ? <Eye className="w-5 h-5" /> : <FileCode className="w-5 h-5" />}
                                                </button>
                                                <button
                                                    onClick={handleCopyRawCode}
                                                    className="p-2 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-colors"
                                                    title="Copy Mermaid code"
                                                >
                                                    <Copy className={`w-5 h-5 ${copiedRaw ? "text-emerald-400" : ""}`} />
                                                </button>
                                            </>
                                        )}
                                        {!isGenerating && svg && !isRawView && (
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
                                <div className="flex-1 min-h-0 overflow-hidden relative diagram-modal-content">
                                    <style>{`
                                        .diagram-modal-content {
                                            display: flex;
                                            align-items: center;
                                            justify-content: center;
                                            overflow: hidden;
                                            padding: 12px;
                                        }
                                        .diagram-modal-content svg {
                                            width: auto !important;
                                            height: auto !important;
                                            max-width: 100% !important;
                                            max-height: 100% !important;
                                            overflow: hidden !important;
                                            display: block;
                                            margin: auto !important;
                                            background: transparent !important;
                                            backface-visibility: hidden;
                                            transform: translateZ(0);
                                            will-change: opacity, transform;
                                        }
                                    `}</style>
                                    <div className="h-full w-full overflow-hidden">
                                        <div className="h-full w-full grid place-items-center">
                                            {isRawView ? (
                                                <div className="h-full w-full overflow-auto rounded-lg border border-white/10 bg-zinc-950/80 p-4 text-xs leading-relaxed text-zinc-200 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                                    {activeMermaidSource || "No Mermaid code available."}
                                                </div>
                                            ) : (
                                                <div
                                                    ref={modalRef}
                                                    className="h-full w-full flex items-center justify-center overflow-hidden"
                                                    dangerouslySetInnerHTML={{ __html: svg }}
                                                />
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>,
                document.body
            )}
        </>
    );
};
