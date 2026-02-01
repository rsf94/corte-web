import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { evaluateSessionAccess } from "../../lib/access_control.js";
import { logAccessDenied } from "../../lib/access_log.js";
import { getAuthOptions } from "../../lib/auth.js";
import LoginButton from "./login-button.js";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getServerSession(getAuthOptions());
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
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center p-6 text-center">
      <h1 className="text-4xl font-semibold">Corte</h1>
      <p className="mt-3 text-sm text-slate-600">
        Inicia sesión con Google para ver tu dashboard.
      </p>
      <LoginButton />
    </main>
  );
}
