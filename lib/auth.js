import { createRequire } from "node:module";
import { isEmailAllowed } from "./allowed_emails.js";

const require = createRequire(import.meta.url);

export function getAuthOptions({
  clientId = process.env.GOOGLE_CLIENT_ID,
  clientSecret = process.env.GOOGLE_CLIENT_SECRET,
  secret = process.env.NEXTAUTH_SECRET,
  nextAuthUrl = process.env.NEXTAUTH_URL,
  nodeEnv = process.env.NODE_ENV
} = {}) {
  const { default: GoogleProvider } = require("next-auth/providers/google");
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
        if (!isEmailAllowed(user?.email)) {
          return "/no-autorizado";
        }
        return true;
      }
    }
  };
}
