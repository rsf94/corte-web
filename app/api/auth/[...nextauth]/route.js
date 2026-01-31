import { createRequire } from "node:module";
import { getAuthOptions } from "../../../../lib/auth.js";

const require = createRequire(import.meta.url);
const requiredAuthEnv = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL"
];

function getMissingAuthEnv() {
  return requiredAuthEnv.filter((name) => !process.env[name]);
}

function authMisconfiguredResponse(request) {
  const { NextResponse } = require("next/server");
  if (request.nextUrl?.pathname?.endsWith("/signin")) {
    return new NextResponse(
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Auth misconfigured</title>
  </head>
  <body>
    <h1>Authentication unavailable</h1>
    <p>The authentication service is not configured. Please contact the administrator.</p>
  </body>
</html>`,
      {
        status: 500,
        headers: {
          "content-type": "text/html; charset=utf-8"
        }
      }
    );
  }

  return NextResponse.json({ error: "Auth misconfigured" }, { status: 500 });
}

async function handler(request, context) {
  const missing = getMissingAuthEnv();
  if (missing.length > 0) {
    return authMisconfiguredResponse(request);
  }

  const NextAuth = require("next-auth");
  const authHandler = NextAuth(getAuthOptions());
  return authHandler(request, context);
}

export { handler as GET, handler as POST };
