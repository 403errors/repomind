import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SecurityScanModal } from "@/components/chat/SecurityScanModal";

describe("SecurityScanModal", () => {
    it("renders a disabled Full Repo Scan coming-soon card with usage guidance", () => {
        const html = renderToStaticMarkup(
            <SecurityScanModal
                isOpen
                isAuthenticated
                deepScansData={{ used: 1, total: 15, resetsAt: new Date().toISOString(), isUnlimited: false }}
                latestScanId={null}
                onClose={vi.fn()}
                onRunQuickScan={vi.fn()}
                onRunDeepScan={vi.fn()}
            />
        );

        expect(html).toContain("Full Repo Scan");
        expect(html).toContain("Coming soon");
        expect(html).toContain("3/month");
        expect(html).toContain("more than 500 files");
        expect(html).toContain("aria-disabled=\"true\"");
    });
});
