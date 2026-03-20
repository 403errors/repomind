import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/Mermaid", () => ({
    Mermaid: ({ chart }: { chart: string }) => <div data-testid="mermaid">{chart}</div>,
}));

vi.mock("@/components/SmartLink", () => ({
    SmartLink: ({ children, href }: { children: React.ReactNode; href?: string }) => (
        <a data-testid="smart-link" href={href}>
            {children}
        </a>
    ),
}));

vi.mock("@/components/RepoCard", () => ({
    RepoCard: () => <div data-testid="repo-card" />,
}));

vi.mock("@/components/DeveloperCard", () => ({
    DeveloperCard: () => <div data-testid="developer-card" />,
}));

vi.mock("@/components/DynamicSVG", () => ({
    DynamicSVG: () => <div data-testid="dynamic-svg" />,
}));

vi.mock("@/components/CodeBlock", () => ({
    CodeBlock: ({ language, value }: { language: string; value: string }) => (
        <pre data-testid="codeblock" data-language={language}>
            {value}
        </pre>
    ),
}));

import { MessageContent } from "@/components/chat/MessageContent";

describe("MessageContent", () => {
    it("converts mermaid-json into mermaid before rendering", () => {
        const html = renderToStaticMarkup(
            <MessageContent
                content={`\`\`\`mermaid-json
{"nodes":[{"id":"A","label":"Start"},{"id":"B","label":"End"}],"edges":[{"from":"A","to":"B"}]}
\`\`\``}
                messageId="msg-1"
            />
        );

        expect(html).toContain('data-testid="mermaid"');
        expect(html).toContain("graph TD");
        expect(html).toContain("Start");
    });

    it("converts typed sequence mermaid-json into mermaid before rendering", () => {
        const html = renderToStaticMarkup(
            <MessageContent
                content={`\`\`\`mermaid-json
{"diagramType":"sequenceDiagram","payload":{"participants":[{"id":"user","label":"User","kind":"actor"},{"id":"api","label":"API"}],"messages":[{"from":"user","to":"api","text":"Request","kind":"sync"}]}}
\`\`\``}
                messageId="msg-1b"
            />
        );

        expect(html).toContain('data-testid="mermaid"');
        expect(html).toContain("sequenceDiagram");
        expect(html).toContain("actor user as User");
    });

    it("falls back to raw json when mermaid-json is malformed", () => {
        const html = renderToStaticMarkup(
            <MessageContent
                content={`\`\`\`mermaid-json
{"nodes":[
\`\`\``}
                messageId="msg-2"
            />
        );

        expect(html).toContain('data-testid="codeblock"');
        expect(html).toContain('data-language="json"');
        expect(html).toContain("&quot;nodes&quot;");
    });
});
