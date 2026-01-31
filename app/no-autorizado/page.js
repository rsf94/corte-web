import SignOutNotice from "./sign-out-notice.js";

export default function NoAutorizadoPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center p-6 text-center">
      <h1 className="text-3xl font-semibold text-slate-900">No autorizado</h1>
      <p className="mt-3 text-sm text-slate-600">
        Tu cuenta no tiene acceso a este dashboard.
      </p>
      <SignOutNotice />
    </main>
  );
}
