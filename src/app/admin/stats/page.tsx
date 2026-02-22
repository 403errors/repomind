import { getAnalyticsData } from "@/lib/analytics";
import { headers, cookies } from "next/headers";
import AdminLoginPage from "./AdminLoginPage";
import StatsDashboardClient from "./StatsDashboardClient";

export const dynamic = 'force-dynamic'; // Ensure real-time data

export default async function AdminStatsPage() {
    const cookieStore = await cookies();
    const isAdmin = cookieStore.get("admin_session")?.value === "authenticated";

    if (!isAdmin) {
        return <AdminLoginPage />;
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
