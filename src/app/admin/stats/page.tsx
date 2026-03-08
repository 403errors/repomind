import { getAnalyticsData } from "@/lib/analytics";
import { auth } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin-auth";
import { headers } from "next/headers";
import AdminLoginPage from "./AdminLoginPage";
import AdminAccessDeniedPage from "./AdminAccessDeniedPage";
import StatsDashboardClient from "./StatsDashboardClient";

export const dynamic = 'force-dynamic'; // Ensure real-time data

export default async function AdminStatsPage() {
    const session = await auth();

    if (!session?.user) {
        return <AdminLoginPage />;
    }
    if (!isAdminUser(session)) {
        return <AdminAccessDeniedPage />;
    }

    const data = await getAnalyticsData();

    // Get current user debug info
    const headersList = await headers();
    const userAgent = headersList.get("user-agent") || "";
    let country = headersList.get("x-vercel-ip-country");
    if (!country && process.env.NODE_ENV === 'development') {
        country = "Local (Dev)";
    }
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent) || /Mobile/i.test(userAgent);

    return (
        <StatsDashboardClient
            data={data}
            userAgent={userAgent}
            country={country || "Unknown"}
            isMobile={isMobile}
        />
    );
}
