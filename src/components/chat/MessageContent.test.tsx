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
        expect(html).toContain("flowchart TD");
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
        expect(html).toContain('actor user as &quot;User&quot;');
    });

    it("converts typed sequence diagram json blocks into mermaid", () => {
        const html = renderToStaticMarkup(
            <MessageContent
                content={`\`\`\`json
{"diagramType":"sequenceDiagram","title":"User-to-AI Data Flow","payload":{"participants":[{"id":"u","label":"User","kind":"actor"},{"id":"api","label":"Backend API","kind":"participant"}],"messages":[{"from":"u","to":"api","text":"Submit coding question","kind":"sync"}]}}
\`\`\``}
                messageId="msg-1c"
            />
        );

        expect(html).toContain('data-testid="mermaid"');
        expect(html).toContain("sequenceDiagram");
        expect(html).toContain('actor u as &quot;User&quot;');
    });

    it("converts unlabeled sequence diagram json blocks into mermaid", () => {
        const html = renderToStaticMarkup(
            <MessageContent
                content={`\`\`\`
{"diagramType":"sequenceDiagram","payload":{"participants":[{"id":"u","label":"User","kind":"actor"},{"id":"ai","label":"AI Model","kind":"participant"}],"messages":[{"from":"u","to":"ai","text":"Ask question","kind":"sync"}]}}
\`\`\``}
                messageId="msg-1d"
            />
        );

        expect(html).toContain('data-testid="mermaid"');
        expect(html).toContain("sequenceDiagram");
        expect(html).toContain("Ask question");
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

    it("shows legacy svg blocks as code with deprecation notice", () => {
        const html = renderToStaticMarkup(
            <MessageContent
                content={`\`\`\`svg
<svg viewBox="0 0 10 10"></svg>
\`\`\``}
                messageId="msg-3"
            />
        );

        expect(html).toContain("Direct SVG rendering is deprecated");
        expect(html).toContain('data-testid="codeblock"');
        expect(html).toContain('data-language="svg"');
    });
});
