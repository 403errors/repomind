import mermaid from "mermaid";
import { APP_FONT_STACK } from "@/lib/design-tokens";

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
        themeVariables: {
            primaryColor: '#18181b', // zinc-900
            primaryTextColor: '#e4e4e7', // zinc-200
            primaryBorderColor: '#3f3f46', // zinc-700
            lineColor: '#a1a1aa', // zinc-400
            secondaryColor: '#27272a', // zinc-800
            tertiaryColor: '#27272a', // zinc-800
            fontFamily: APP_FONT_STACK,
        },
        themeCSS: `
            .label, .label text, .nodeLabel, .edgeLabel, .cluster-label, text {
                font-family: ${APP_FONT_STACK} !important;
            }
            .label {
                fill: #e4e4e7 !important;
            }
        `,
    });
};
