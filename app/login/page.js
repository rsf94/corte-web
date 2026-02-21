import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { evaluateSessionAccess } from "../../lib/access_control.js";
import { logAccessDenied } from "../../lib/access_log.js";
import { getAuthOptions } from "../../lib/auth.js";
import { getSessionWithE2EBypass } from "../../lib/e2e_auth_bypass.js";
import LoginButton from "./login-button.js";

export const dynamic = "force-dynamic";

function resolveCallbackUrl(value) {
  if (!value) return "/dashboard";
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return "/dashboard";
  return candidate.startsWith("/") ? candidate : "/dashboard";
}

export default async function LoginPage({ searchParams }) {
  const session = await getSessionWithE2EBypass(() => getServerSession(getAuthOptions()));
  const callbackUrl = resolveCallbackUrl(searchParams?.callbackUrl);
  if (session) {
    const access = evaluateSessionAccess(session);
    if (access.status !== "ok") {
      logAccessDenied({
        reason: access.status,
        email: access.email,
        path: "/login"
      });
      redirect("/unauthorized");
    }
    redirect(callbackUrl);
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center p-6 text-center">
      <h1 className="text-4xl font-semibold">Corte</h1>
      <p className="mt-3 text-sm text-slate-600">
        Inicia sesión con Google para ver tu dashboard.
      </p>
      <LoginButton callbackUrl={callbackUrl} />
    </main>
  );
}
