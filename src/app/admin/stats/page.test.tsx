import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminAccessDeniedPage from "@/app/admin/stats/AdminAccessDeniedPage";
import AdminLoginPage from "@/app/admin/stats/AdminLoginPage";
import StatsDashboardClient from "@/app/admin/stats/StatsDashboardClient";

const {
    authMock,
    isAdminUserMock,
    getAnalyticsDataMock,
    headersMock,
} = vi.hoisted(() => ({
    authMock: vi.fn(),
    isAdminUserMock: vi.fn(),
    getAnalyticsDataMock: vi.fn(),
    headersMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
    auth: authMock,
}));

vi.mock("@/lib/admin-auth", () => ({
    isAdminUser: isAdminUserMock,
}));

vi.mock("@/lib/analytics", () => ({
    getAnalyticsData: getAnalyticsDataMock,
}));

vi.mock("next/headers", () => ({
    headers: headersMock,
}));

import AdminStatsPage from "@/app/admin/stats/page";

describe("AdminStatsPage", () => {
    beforeEach(() => {
        authMock.mockReset();
        isAdminUserMock.mockReset();
        getAnalyticsDataMock.mockReset();
        headersMock.mockReset();
        headersMock.mockResolvedValue({
            get: () => null,
        });
    });

    it("renders the GitHub login view when unauthenticated", async () => {
        authMock.mockResolvedValue(null);

        const view = await AdminStatsPage() as ReactElement;

        expect(view.type).toBe(AdminLoginPage);
        expect(getAnalyticsDataMock).not.toHaveBeenCalled();
    });

    it("renders access denied for authenticated non-admin users", async () => {
        const session = { user: { id: "123", username: "someone-else" } };
        authMock.mockResolvedValue(session);
        isAdminUserMock.mockReturnValue(false);

        const view = await AdminStatsPage() as ReactElement;

        expect(isAdminUserMock).toHaveBeenCalledWith(session);
        expect(view.type).toBe(AdminAccessDeniedPage);
        expect(getAnalyticsDataMock).not.toHaveBeenCalled();
    });

    it("renders stats dashboard for authorized admin users", async () => {
        const session = { user: { id: "123", username: "403errors" } };
        const data = {
            totalVisitors: 10,
            totalQueries: 20,
            recentVisitors: [],
            countryStats: {},
            deviceStats: {},
            kvStats: { currentSize: 10, maxSize: 100 },
        };

        authMock.mockResolvedValue(session);
        isAdminUserMock.mockReturnValue(true);
        getAnalyticsDataMock.mockResolvedValue(data);
        headersMock.mockResolvedValue({
            get: (key: string) => {
                if (key === "user-agent") return "Mozilla/5.0 (iPhone)";
                if (key === "x-vercel-ip-country") return "IN";
                return null;
            },
        });

        const view = await AdminStatsPage() as ReactElement<{
            data: unknown;
            country: string;
            isMobile: boolean;
        }>;

        expect(view.type).toBe(StatsDashboardClient);
        expect(getAnalyticsDataMock).toHaveBeenCalledOnce();
        expect(view.props.data).toEqual(data);
        expect(view.props.country).toBe("IN");
        expect(view.props.isMobile).toBe(true);
    });
});
