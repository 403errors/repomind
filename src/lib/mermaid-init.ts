import mermaid from "mermaid";
import { APP_FONT_STACK } from "@/lib/design-tokens";

const DIAGRAM_THEME = {
    primary: "#4f46e5",
    secondary: "#1f2937",
    accent1: "#1d4ed8",
    accent2: "#0e7490",
    accent3: "#047857",
    accent4: "#6d28d9",
    accent5: "#b45309",
    accent6: "#be185d",
    line: "#6366f1",
    surface: "#111827",
    border: "#475569",
    textOnColor: "#f8fafc",
    axis: "#94a3b8",
} as const;

export const MERMAID_THEME_VARIABLES = {
    primaryColor: DIAGRAM_THEME.primary,
    primaryTextColor: DIAGRAM_THEME.textOnColor,
    primaryBorderColor: DIAGRAM_THEME.border,
    lineColor: DIAGRAM_THEME.line,
    secondaryColor: DIAGRAM_THEME.secondary,
    tertiaryColor: DIAGRAM_THEME.surface,
    mainBkg: DIAGRAM_THEME.surface,
    rowOdd: DIAGRAM_THEME.secondary,
    rowEven: "#0f172a",
    attributeBackgroundColorOdd: DIAGRAM_THEME.secondary,
    attributeBackgroundColorEven: "#0f172a",
    nodeBorder: DIAGRAM_THEME.border,
    nodeTextColor: DIAGRAM_THEME.textOnColor,
    textColor: DIAGRAM_THEME.textOnColor,
    actorBkg: DIAGRAM_THEME.secondary,
    actorBorder: DIAGRAM_THEME.border,
    actorTextColor: DIAGRAM_THEME.textOnColor,
    noteBkgColor: DIAGRAM_THEME.secondary,
    noteBorderColor: DIAGRAM_THEME.border,
    noteTextColor: DIAGRAM_THEME.textOnColor,
    clusterBkg: DIAGRAM_THEME.secondary,
    clusterBorder: DIAGRAM_THEME.border,
    fontFamily: APP_FONT_STACK,
    xyChart: {
        backgroundColor: "transparent",
        titleColor: DIAGRAM_THEME.textOnColor,
        xAxisLabelColor: DIAGRAM_THEME.textOnColor,
        xAxisTitleColor: DIAGRAM_THEME.textOnColor,
        xAxisTickColor: DIAGRAM_THEME.axis,
        xAxisLineColor: DIAGRAM_THEME.axis,
        yAxisLabelColor: DIAGRAM_THEME.textOnColor,
        yAxisTitleColor: DIAGRAM_THEME.textOnColor,
        yAxisTickColor: DIAGRAM_THEME.axis,
        yAxisLineColor: DIAGRAM_THEME.axis,
        plotColorPalette: `${DIAGRAM_THEME.primary}, ${DIAGRAM_THEME.accent2}, ${DIAGRAM_THEME.accent3}, ${DIAGRAM_THEME.accent4}, ${DIAGRAM_THEME.accent5}, ${DIAGRAM_THEME.accent6}`,
    },
} as const;

export const MERMAID_THEME_CSS = `
    .label, .label text, .nodeLabel, .edgeLabel, .cluster-label, text {
        font-family: ${APP_FONT_STACK} !important;
    }
    .label,
    .label text,
    .nodeLabel,
    .cluster-label,
    text {
        fill: ${DIAGRAM_THEME.textOnColor} !important;
    }
    .edgeLabel {
        background: ${DIAGRAM_THEME.surface} !important;
        padding: 2px 6px !important;
        border-radius: 6px !important;
    }
    .edgeLabel rect {
        fill: ${DIAGRAM_THEME.surface} !important;
        opacity: 0.95 !important;
        stroke: ${DIAGRAM_THEME.border} !important;
    }
    .node rect,
    .node polygon,
    .node circle,
    .node ellipse {
        fill: ${DIAGRAM_THEME.surface} !important;
        stroke: ${DIAGRAM_THEME.border} !important;
    }
    .cluster rect {
        fill: ${DIAGRAM_THEME.secondary} !important;
        stroke: ${DIAGRAM_THEME.border} !important;
    }
    .edgePath path,
    path.flowchart-link,
    .relation,
    .stateDiagram .transition,
    .messageLine0,
    .messageLine1,
    .loopLine {
        stroke: ${DIAGRAM_THEME.line} !important;
        stroke-width: 1.5px !important;
        stroke-linecap: round !important;
        stroke-linejoin: round !important;
        fill: none !important;
        filter: none !important;
        opacity: 1 !important;
    }
    .marker,
    marker path {
        fill: ${DIAGRAM_THEME.line} !important;
        stroke: ${DIAGRAM_THEME.line} !important;
    }
    .actor rect,
    .actor-man line,
    .actor-line {
        fill: ${DIAGRAM_THEME.secondary} !important;
        stroke: ${DIAGRAM_THEME.border} !important;
    }
    .classBox,
    .classTitle {
        fill: ${DIAGRAM_THEME.secondary} !important;
        stroke: ${DIAGRAM_THEME.border} !important;
    }
    .classLabel .label,
    .classLabel text {
        fill: ${DIAGRAM_THEME.textOnColor} !important;
    }
    .gantt .task,
    .gantt .task0,
    .gantt .task1,
    .gantt .task2,
    .gantt .task3 {
        fill: ${DIAGRAM_THEME.primary} !important;
        stroke: ${DIAGRAM_THEME.primary} !important;
    }
    .gantt .active0,
    .gantt .active1,
    .gantt .active2,
    .gantt .active3 {
        fill: ${DIAGRAM_THEME.accent2} !important;
        stroke: ${DIAGRAM_THEME.accent2} !important;
    }
    .gantt .done0,
    .gantt .done1,
    .gantt .done2,
    .gantt .done3 {
        fill: ${DIAGRAM_THEME.accent4} !important;
        stroke: ${DIAGRAM_THEME.accent4} !important;
    }
    .gantt .taskText,
    .gantt .taskTextOutsideRight,
    .gantt .taskTextOutsideLeft,
    .gantt text {
        fill: ${DIAGRAM_THEME.textOnColor} !important;
    }
    .er .entityBox {
        fill: ${DIAGRAM_THEME.surface} !important;
        stroke: ${DIAGRAM_THEME.border} !important;
    }
    .er .entityBox rect,
    .er .labelBkg rect,
    .er .relationshipLabelBox,
    .er .relationshipLabelBox rect {
        fill: ${DIAGRAM_THEME.secondary} !important;
        opacity: 1 !important;
    }
    .er g.row-rect-odd path,
    .er g.row-rect-odd rect,
    .er g.row-rect-even path,
    .er g.row-rect-even rect {
        opacity: 1 !important;
    }
    .er g.row-rect-odd path,
    .er g.row-rect-odd rect {
        fill: ${DIAGRAM_THEME.secondary} !important;
    }
    .er g.row-rect-even path,
    .er g.row-rect-even rect {
        fill: #0f172a !important;
    }
    .er .label,
    .er .label text,
    .er text {
        fill: ${DIAGRAM_THEME.textOnColor} !important;
    }
`;

/**
 * Centralized Mermaid initialization
 * Ensures consistent theme and configuration across all components
 */
export const initMermaid = () => {
    mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        securityLevel: 'strict', // Prevent XSS attacks by enabling HTML sanitization
        suppressErrorRendering: true, // Prevent default error message from appearing at bottom of screen
        flowchart: {
            htmlLabels: false,
            useMaxWidth: true,
            curve: "basis",
            nodeSpacing: 55,
            rankSpacing: 60,
        },
        sequence: {
            useMaxWidth: true,
            actorMargin: 70,
            messageMargin: 52,
            boxMargin: 12,
        },
        mindmap: {
            padding: 6,
            maxNodeWidth: 170,
            layoutAlgorithm: "tidy-tree",
        },
        themeVariables: MERMAID_THEME_VARIABLES,
        themeCSS: MERMAID_THEME_CSS,
    });
};
