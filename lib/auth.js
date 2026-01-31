import GoogleProvider from "next-auth/providers/google";
import { isEmailAllowed } from "./allowed_emails.js";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env ${name}`);
  }
  return value;
}

export function getAuthOptions() {
  const isSecureCookie =
    process.env.NEXTAUTH_URL?.startsWith("https://") || process.env.NODE_ENV === "production";

  return {
    providers: [
      GoogleProvider({
        clientId: requiredEnv("GOOGLE_CLIENT_ID"),
        clientSecret: requiredEnv("GOOGLE_CLIENT_SECRET")
      })
    ],
    pages: {
      signIn: "/login"
    },
    session: {
      strategy: "jwt"
    },
    secret: requiredEnv("NEXTAUTH_SECRET"),
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
