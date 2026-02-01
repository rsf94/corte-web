import { createRequire } from "node:module";
import { getAllowedEmails, isEmailAllowed } from "./allowed_emails.js";
import { logAccessDenied } from "./access_log.js";

const require = createRequire(import.meta.url);

export function getAuthOptions({
  clientId = process.env.GOOGLE_CLIENT_ID,
  clientSecret = process.env.GOOGLE_CLIENT_SECRET,
  secret = process.env.NEXTAUTH_SECRET,
  nextAuthUrl = process.env.NEXTAUTH_URL,
  nodeEnv = process.env.NODE_ENV
} = {}) {
  const GoogleProviderImport = require("next-auth/providers/google");
  const GoogleProvider = GoogleProviderImport?.default ?? GoogleProviderImport;
  const isSecureCookie = nextAuthUrl?.startsWith("https://") || nodeEnv === "production";

  return {
    providers: [
      GoogleProvider({
        clientId,
        clientSecret
      })
    ],
    pages: {
      signIn: "/login"
    },
    session: {
      strategy: "jwt"
    },
    secret,
    trustHost: true,
    useSecureCookies: isSecureCookie,
    callbacks: {
      async signIn({ user }) {
        const allowedEmails = getAllowedEmails();
        const email = user?.email ?? "";
        if (!allowedEmails.length) {
          logAccessDenied({ reason: "missing_allowlist", email, path: "/login" });
          return "/unauthorized";
        }
        if (!isEmailAllowed(email, allowedEmails)) {
          logAccessDenied({ reason: "email_not_allowed", email, path: "/login" });
          return "/unauthorized";
        }
        return true;
      }
    }
  };
}
