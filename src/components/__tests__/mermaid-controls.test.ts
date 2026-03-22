import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const mermaidComponentSource = readFileSync(
    path.resolve(process.cwd(), "src/components/Mermaid.tsx"),
    "utf8"
);

describe("Mermaid raw/preview controls", () => {
    it("supports optional rawCode prop and raw-preview toggle state", () => {
        expect(mermaidComponentSource).toContain("rawCode?: string");
        expect(mermaidComponentSource).toContain("const [isRawView, setIsRawView] = useState(false);");
        expect(mermaidComponentSource).toContain("setIsRawView((prev) => !prev)");
    });

    it("includes copy handler for Mermaid raw code", () => {
        expect(mermaidComponentSource).toContain("const handleCopyRawCode = async");
        expect(mermaidComponentSource).toContain("navigator.clipboard.writeText(activeMermaidSource)");
        expect(mermaidComponentSource).toContain("Mermaid code copied");
    });

    it("prevents control clicks from opening fullscreen preview unintentionally", () => {
        expect(mermaidComponentSource).toContain("e.stopPropagation()");
        expect(mermaidComponentSource).toContain("if (!isGenerating && svg && !isRawView)");
    });
});
