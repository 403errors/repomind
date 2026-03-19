import type { SvgComplexityTarget } from "@/lib/visual-intent";

export interface SvgQualityMetrics {
    nodeCount: number;
    edgeCount: number;
    laneCount: number;
    routeCount: number;
    routeCoverageCount: number;
    beadCount: number;
    animateMotionCount: number;
    mpathRefCount: number;
    hasLegend: boolean;
    hasTitle: boolean;
}

export interface SvgQualityResult {
    ok: boolean;
    failures: string[];
    metrics: SvgQualityMetrics;
}

export function extractFirstSvgCodeBlock(markdown: string): string | null {
    const match = markdown.match(/```svg\s*([\s\S]*?)\s*```/i);
    return match?.[1]?.trim() || null;
}

function countMatches(content: string, pattern: RegExp): number {
    return Array.from(content.matchAll(pattern)).length;
}

function getNumericAttr(tag: string, attr: string): number | null {
    const regex = new RegExp(`${attr}=(["'])([^"']+)\\1`, "i");
    const match = tag.match(regex);
    if (!match) return null;
    const parsed = Number.parseFloat(match[2]);
    return Number.isFinite(parsed) ? parsed : null;
}

function estimateNodeCount(svg: string): number {
    const byClass = countMatches(svg, /<[^>]*class=(['"])[^"']*\bnode\b[^"']*\1[^>]*>/gi);
    if (byClass > 0) return byClass;

    // Fallback: count non-background rects if class tags are missing.
    const rectTags = Array.from(svg.matchAll(/<rect\b[^>]*>/gi)).map((match) => match[0]);
    let count = 0;

    for (const tag of rectTags) {
        const width = getNumericAttr(tag, "width");
        const height = getNumericAttr(tag, "height");

        // Ignore canvas/background-like rectangles.
        if (width !== null && height !== null && width >= 700 && height >= 300) {
            continue;
        }
        count += 1;
    }

    return count;
}

function estimateEdgeCount(svg: string): number {
    const byClass = countMatches(svg, /<path\b[^>]*class=(['"])[^"']*\bedge\b[^"']*\1[^>]*>/gi);
    if (byClass > 0) return byClass;

    const pathTags = Array.from(svg.matchAll(/<path\b[^>]*>/gi)).map((match) => match[0]);
    const routePaths = pathTags.filter((tag) => /id=(['"])route-[^"']+\1/i.test(tag)).length;
    return Math.max(0, pathTags.length - routePaths);
}

function extractRouteIds(svg: string): string[] {
    return Array.from(svg.matchAll(/<path\b[^>]*id=(['"])(route-[^"']+)\1[^>]*>/gi), (match) => match[2]);
}

function extractBeadRouteRefs(svg: string): string[] {
    return Array.from(svg.matchAll(/<mpath\b[^>]*(?:href|xlink:href)=(['"])#(route-[^"']+)\1/gi), (match) => match[2]);
}

function buildMetrics(svg: string): SvgQualityMetrics {
    const nodeCount = estimateNodeCount(svg);
    const edgeCount = estimateEdgeCount(svg);
    const laneCount = countMatches(svg, /<[^>]*class=(['"])[^"']*\blane\b[^"']*\1[^>]*>/gi);
    const routeCount = countMatches(svg, /<path\b[^>]*id=(['"])route-[^"']+\1[^>]*>/gi);
    const routeIds = extractRouteIds(svg);
    const beadRouteRefs = new Set(extractBeadRouteRefs(svg));
    const routeCoverageCount = routeIds.filter((routeId) => beadRouteRefs.has(routeId)).length;
    const beadCountByClass = countMatches(svg, /<circle\b[^>]*class=(['"])[^"']*\bbead\b[^"']*\1[^>]*>/gi);
    const beadCount = beadCountByClass > 0 ? beadCountByClass : countMatches(svg, /<animateMotion\b/gi);
    const animateMotionCount = countMatches(svg, /<animateMotion\b/gi);
    const mpathRefCount = countMatches(svg, /<mpath\b[^>]*(?:href|xlink:href)=(['"])#route-[^"']+\1/gi);
    const hasLegend = /\blegend\b/i.test(svg);
    const hasTitle =
        /class=(['"])[^"']*\btitle\b[^"']*\1/i.test(svg) ||
        /<text\b[^>]*>\s*[^<]{3,120}\s*<\/text>/i.test(svg);

    return {
        nodeCount,
        edgeCount,
        laneCount,
        routeCount,
        routeCoverageCount,
        beadCount,
        animateMotionCount,
        mpathRefCount,
        hasLegend,
        hasTitle,
    };
}

export function validateAnimatedSvgMarkdown(markdown: string, target: SvgComplexityTarget): SvgQualityResult {
    const svg = extractFirstSvgCodeBlock(markdown);
    if (!svg) {
        return {
            ok: false,
            failures: ["Missing ```svg``` code block in the response."],
            metrics: {
                nodeCount: 0,
                edgeCount: 0,
                laneCount: 0,
                routeCount: 0,
                routeCoverageCount: 0,
                beadCount: 0,
                animateMotionCount: 0,
                mpathRefCount: 0,
                hasLegend: false,
                hasTitle: false,
            },
        };
    }

    const metrics = buildMetrics(svg);
    const failures: string[] = [];

    if (metrics.nodeCount < target.minNodes) {
        failures.push(`Need at least ${target.minNodes} logical nodes; found ${metrics.nodeCount}.`);
    }

    if (metrics.edgeCount < target.minEdges) {
        failures.push(`Need at least ${target.minEdges} connection edges; found ${metrics.edgeCount}.`);
    }

    if (metrics.laneCount < target.minLanes) {
        failures.push(`Need at least ${target.minLanes} lanes/swimlanes; found ${metrics.laneCount}.`);
    }

    if (metrics.routeCount === 0) {
        failures.push('Missing route paths with id="route-*" for bead motion.');
    }

    if (metrics.beadCount < metrics.routeCount) {
        failures.push(`Need at least one animated bead per route; found ${metrics.beadCount} beads for ${metrics.routeCount} routes.`);
    }

    if (metrics.routeCoverageCount < metrics.routeCount) {
        failures.push(`Every route must be covered by at least one bead; only ${metrics.routeCoverageCount} of ${metrics.routeCount} routes were covered.`);
    }

    if (metrics.routeCount > 0 && metrics.beadCount > metrics.routeCount * target.maxBeadsPerRoute) {
        failures.push(
            `Too many beads (${metrics.beadCount}) for ${metrics.routeCount} routes; max is ${target.maxBeadsPerRoute} per route.`
        );
    }

    if (metrics.animateMotionCount < metrics.beadCount) {
        failures.push("Each bead must include animateMotion.");
    }

    if (metrics.mpathRefCount < metrics.beadCount) {
        failures.push("Each bead motion must reference a #route-* path via <mpath>.");
    }

    if (!metrics.hasLegend) {
        failures.push("Diagram must include a legend section.");
    }

    if (!metrics.hasTitle) {
        failures.push("Diagram must include a visible title.");
    }

    return {
        ok: failures.length === 0,
        failures,
        metrics,
    };
}
