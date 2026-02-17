import { getAllowedEmails } from "../../lib/allowed_emails.js";

export const dynamic = "force-dynamic";

export default function UnauthorizedPage() {
  const allowedEmails = getAllowedEmails();
  const missingAllowlist = allowedEmails.length === 0;

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center p-6 text-center">
      <h1 className="text-3xl font-semibold">No autorizado</h1>
      {missingAllowlist ? (
        <p className="mt-3 text-sm text-slate-600">
          No hay una allowlist configurada (<code>AUTH_ALLOWED_EMAILS</code>). Un
          administrador debe definirla para permitir el acceso.
        </p>
      ) : (
        <p className="mt-3 text-sm text-slate-600">
          Tu cuenta no está autorizada. Solicita acceso.
        </p>
      )}
    </main>
  );
}
