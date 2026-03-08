import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

type SessionWithAccessToken = {
    accessToken?: string;
};

export async function GET() {
    const session = await auth();

    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accessToken = (session as SessionWithAccessToken).accessToken;
    // Fall back to the global token if the user hasn't explicitly authorized their own account token
    // Note: The global token won't have access to the user's private repos, only public ones.
    const tokenToUse = accessToken || process.env.GITHUB_TOKEN;

    if (!tokenToUse) {
        return NextResponse.json({ error: "No GitHub token available" }, { status: 500 });
    }

    try {
        const res = await fetch("https://api.github.com/user/repos?sort=updated&per_page=100", {
            headers: {
                Authorization: `Bearer ${tokenToUse}`,
                Accept: "application/vnd.github.v3+json",
            },
            next: { revalidate: 60 } // Cache for 1 minute
        });

        if (!res.ok) {
            console.error("GitHub API error fetching user repos", await res.text());
            return NextResponse.json({ error: "Failed to fetch repositories" }, { status: res.status });
        }

        const data: unknown = await res.json();
        const repos = Array.isArray(data) ? data : [];

        // Check if the token we used was the user's specific access token (which implies we requested scopes)
        // If they have private repos returned, or if they successfully used an access_token, we assume they have private access.
        const hasPrivateAccess = !!accessToken && repos.length > 0;

        return NextResponse.json({
            repos,
            hasPrivateAccess,
        });

    } catch (error) {
        console.error("Error fetching user repos:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
