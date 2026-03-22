import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReasoningBlock } from "@/components/ReasoningBlock";

describe("ReasoningBlock", () => {
    it("keeps collapsed reasoning text wrap-safe on mobile while preserving desktop compact style", () => {
        const html = renderToStaticMarkup(
            <ReasoningBlock
                isStreaming={true}
                steps={["**Tool Status** Calling tool.with.long.details.that.should.wrap_on_small_screens_instead_of_overflow"]}
            />
        );

        expect(html).toContain("[overflow-wrap:anywhere]");
        expect(html).toContain("sm:truncate");
        expect(html).toContain("sm:whitespace-nowrap");
    });

    it("shows thinking indicator when streaming begins with no detailed steps yet", () => {
        const html = renderToStaticMarkup(<ReasoningBlock isStreaming={true} steps={[]} />);
        expect(html).toContain("Thinking");
    });
});
