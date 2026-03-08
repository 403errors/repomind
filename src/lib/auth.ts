import NextAuth from "next-auth"
import GitHub from "next-auth/providers/github"
import { kv } from '@vercel/kv'
import { sendWelcomeEmail } from "./emails/mailer"

export const { handlers, auth, signIn, signOut } = NextAuth({
    providers: [
        GitHub({
            clientId: process.env.AUTH_GITHUB_ID,
            clientSecret: process.env.AUTH_GITHUB_SECRET,
        }),
    ],
    callbacks: {
        authorized({ auth, request: { nextUrl } }) {
            const isLoggedIn = !!auth?.user
            const isOnDashboard = nextUrl.pathname.startsWith("/dashboard")
            if (isOnDashboard) {
                if (isLoggedIn) return true
                return false // Redirect unauthenticated users to login page
            }
            return true
        },
        async signIn({ user, profile }) {
            // Check if user is logging in for the first time
            if (user?.email) {
                const hasSentWelcomeEmail = await kv.get(`welcome_email_sent:${user.email}`)
                if (!hasSentWelcomeEmail) {
                    // Set the flag first to prevent duplicate emails
                    await kv.set(`welcome_email_sent:${user.email}`, true)

                    // Send the welcome email
                    const username = profile?.login || user.name || user.email.split('@')[0]

                    // Run asynchronously so we don't block the sign-in flow
                    sendWelcomeEmail(user.email, username as string).catch(console.error)
                }
            }
            return true
        },
        async jwt({ token, profile, account, user }) {
            if (user?.id) {
                token.id = user.id;
            }
            if (profile?.login) {
                token.username = profile.login;
            }
            if (account?.access_token) {
                token.accessToken = account.access_token;
            }
            if (account?.scope) {
                token.oauthScope = account.scope;
            }
            return token;
        },
        async session({ session, token }) {
            if (typeof token.id === "string" && session.user) {
                session.user.id = token.id;
            }
            if (typeof token.username === "string" && session.user) {
                session.user.username = token.username;
            }
            if (typeof token.accessToken === "string") {
                session.accessToken = token.accessToken;
            }
            if (typeof token.oauthScope === "string") {
                session.oauthScope = token.oauthScope;
            }
            return session;
        },
    },
    pages: {
        signIn: "/", // We'll show a sign-in modal on home page
    }
})
