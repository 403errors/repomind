import type { DefaultSession } from "next-auth";

declare module "next-auth" {
    interface Session {
        user: DefaultSession["user"] & {
            id?: string;
            username?: string;
        };
        accessToken?: string;
        oauthScope?: string;
    }

    interface User {
        id?: string;
        username?: string;
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        id?: string;
        username?: string;
        accessToken?: string;
        oauthScope?: string;
    }
}
