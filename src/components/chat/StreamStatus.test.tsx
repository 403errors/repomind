import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StreamStatus } from "@/components/chat/StreamStatus";

describe("StreamStatus", () => {
    it("uses wrap-safe mobile-friendly text layout for long streaming messages", () => {
        const html = renderToStaticMarkup(
            <StreamStatus
                isStreaming={true}
                message="Calling veryLongToolName.with.deep.parameters(and_more_details_that_should_wrap_on_mobile_without_overflow)"
            />
        );

        expect(html).toContain("items-start");
        expect(html).toContain("[overflow-wrap:anywhere]");
        expect(html).not.toContain("truncate");
    });

    it("renders nothing when not streaming", () => {
        const html = renderToStaticMarkup(<StreamStatus isStreaming={false} message="Working..." />);
        expect(html).toBe("");
    });
});
