import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const requiredAuthEnv = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL"
];

function getNextResponse() {
  try {
    return require("next/server").NextResponse;
  } catch (error) {
    return null;
  }
}

function jsonResponse(payload, init) {
  const NextResponse = getNextResponse();
  if (NextResponse?.json) {
    return NextResponse.json(payload, init);
  }

  return new Response(JSON.stringify(payload), {
    status: init?.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init?.headers
    }
  });
}

function htmlResponse(html, init) {
  const NextResponse = getNextResponse();
  if (NextResponse) {
    return new NextResponse(html, init);
  }

  return new Response(html, {
    status: init?.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...init?.headers
    }
  });
}

function getMissingAuthEnv() {
  return requiredAuthEnv.filter((name) => !process.env[name]);
}

function authMisconfiguredResponse(request) {
  if (request.nextUrl?.pathname?.endsWith("/signin")) {
    return htmlResponse(
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

  return jsonResponse({ error: "Auth misconfigured" }, { status: 500 });
}

async function handleAuth(request, context) {
  const missing = getMissingAuthEnv();
  if (missing.length > 0) {
    console.error("Auth misconfigured: missing env vars", missing);
    return authMisconfiguredResponse(request);
  }

  try {
    const NextAuthImport = require("next-auth");
    const NextAuth = NextAuthImport?.default ?? NextAuthImport;
    const { getAuthOptions } = await import("../../../../lib/auth.js");
    const authHandler = NextAuth(getAuthOptions());
    return authHandler(request, context);
  } catch (error) {
    console.error("Auth handler failure", {
      name: error?.name,
      message: error?.message
    });
    return jsonResponse({ error: "Auth error" }, { status: 500 });
  }
}

export async function GET(request, context) {
  return handleAuth(request, context);
}

export async function POST(request, context) {
  return handleAuth(request, context);
}
