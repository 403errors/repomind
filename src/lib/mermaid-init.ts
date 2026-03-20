import mermaid from "mermaid";
import { APP_FONT_STACK } from "@/lib/design-tokens";

export const MERMAID_THEME_VARIABLES = {
    primaryColor: '#18181b', // zinc-900
    primaryTextColor: '#e4e4e7', // zinc-200
    primaryBorderColor: '#3f3f46', // zinc-700
    lineColor: '#a1a1aa', // zinc-400
    secondaryColor: '#27272a', // zinc-800
    tertiaryColor: '#27272a', // zinc-800
    mainBkg: '#18181b',
    rowOdd: '#27272a',
    rowEven: '#1f1f23',
    attributeBackgroundColorOdd: '#27272a',
    attributeBackgroundColorEven: '#1f1f23',
    nodeBorder: '#3f3f46',
    nodeTextColor: '#e4e4e7',
    textColor: '#e4e4e7',
    fontFamily: APP_FONT_STACK,
} as const;

export const MERMAID_THEME_CSS = `
    .label, .label text, .nodeLabel, .edgeLabel, .cluster-label, text {
        font-family: ${APP_FONT_STACK} !important;
    }
    .label {
        fill: #e4e4e7 !important;
    }
    .er .entityBox {
        fill: #18181b !important;
        stroke: #3f3f46 !important;
    }
    .er .entityBox rect,
    .er .labelBkg rect,
    .er .relationshipLabelBox,
    .er .relationshipLabelBox rect {
        fill: #27272a !important;
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
        fill: #27272a !important;
    }
    .er g.row-rect-even path,
    .er g.row-rect-even rect {
        fill: #1f1f23 !important;
    }
    .er .label,
    .er .label text,
    .er text {
        fill: #e4e4e7 !important;
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
        themeVariables: MERMAID_THEME_VARIABLES,
        themeCSS: MERMAID_THEME_CSS,
    });
};
