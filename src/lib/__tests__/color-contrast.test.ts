import { describe, expect, it } from "vitest";
import { getContrastRatio, pickContrastingTextColor } from "@/lib/color-contrast";

describe("color contrast helpers", () => {
    it("prefers dark text for light branch colors", () => {
        expect(pickContrastingTextColor("#fcd34d", "#0f172a", "#f8fafc")).toBe("#0f172a");
        expect(pickContrastingTextColor("#6ee7b7", "#0f172a", "#f8fafc")).toBe("#0f172a");
    });

    it("prefers light text for dark branch colors", () => {
        expect(pickContrastingTextColor("#1d4ed8", "#0f172a", "#f8fafc")).toBe("#f8fafc");
        expect(pickContrastingTextColor("#155e75", "#0f172a", "#f8fafc")).toBe("#f8fafc");
    });

    it("computes higher contrast for dark text on yellow", () => {
        const dark = getContrastRatio("#fcd34d", "#0f172a");
        const light = getContrastRatio("#fcd34d", "#f8fafc");
        expect(dark).not.toBeNull();
        expect(light).not.toBeNull();
        expect(dark!).toBeGreaterThan(light!);
    });
});
