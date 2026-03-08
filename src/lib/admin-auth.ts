import type { Session } from "next-auth";

export function isAdminUser(session: Session | null | undefined): boolean {
    const configuredAdmin = process.env.ADMIN_GITHUB_USERNAME;
    if (!configuredAdmin) return false;

    return session?.user?.username === configuredAdmin;
}
