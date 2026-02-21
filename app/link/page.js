import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { evaluateSessionAccess } from "../../lib/access_control.js";
import { logAccessDenied } from "../../lib/access_log.js";
import { getAuthOptions } from "../../lib/auth.js";
import { getSessionWithE2EBypass } from "../../lib/e2e_auth_bypass.js";
import { parseLinkToken } from "../../lib/link_token.js";
import { upsertUserLink } from "../../lib/user_links.js";

export const dynamic = "force-dynamic";

function toSingleValue(value) {
  if (!value) return "";
  return Array.isArray(value) ? value[0] ?? "" : value;
}

function buildReturnUrl(searchParams) {
  const params = new URLSearchParams();
  Object.entries(searchParams ?? {}).forEach(([key, value]) => {
    const normalized = toSingleValue(value);
    if (normalized) {
      params.set(key, normalized);
    }
  });
  const query = params.toString();
  return query ? `/link?${query}` : "/link";
}

export default async function LinkPage({ searchParams }) {
  const code = toSingleValue(searchParams?.code);

  if (!code) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-2xl font-semibold">Vincula tu cuenta</h1>
        <p className="mt-3 text-slate-600">
          Para vincular tu chat de Telegram con tu cuenta de Google usa el comando{" "}
          <strong>/dashboard</strong> en el bot y abre el enlace que recibas.
        </p>
      </main>
    );
  }

  const session = await getSessionWithE2EBypass(() => getServerSession(getAuthOptions()));
  if (!session) {
    const returnUrl = buildReturnUrl(searchParams);
    redirect(`/login?callbackUrl=${encodeURIComponent(returnUrl)}`);
  }

  const access = evaluateSessionAccess(session);
  if (access.status !== "ok") {
    logAccessDenied({ reason: access.status, email: access.email, path: "/link" });
    redirect("/unauthorized");
  }

  let parsed;
  try {
    parsed = parseLinkToken(code);
  } catch (error) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-2xl font-semibold">No se pudo vincular</h1>
        <p className="mt-3 text-slate-600">
          Falta configuración del servidor para validar el enlace.
        </p>
      </main>
    );
  }

  if (!parsed.valid) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-2xl font-semibold">Enlace inválido</h1>
        <p className="mt-3 text-slate-600">
          El enlace expiró o no es válido. Solicita un nuevo enlace con{" "}
          <strong>/dashboard</strong> en Telegram.
        </p>
      </main>
    );
  }

  await upsertUserLink({ email: access.email, chatId: parsed.chatId });
  redirect("/dashboard");
}
