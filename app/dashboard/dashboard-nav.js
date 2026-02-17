import Link from "next/link";

export default function DashboardNav() {
  return (
    <nav className="flex items-center gap-2 text-sm font-medium">
      <Link className="rounded px-3 py-1.5 text-slate-700 transition hover:bg-slate-100" href="/dashboard">
        Resumen
      </Link>
      <Link className="rounded px-3 py-1.5 text-slate-700 transition hover:bg-slate-100" href="/dashboard/expenses">
        Gastos
      </Link>
      <Link className="rounded px-3 py-1.5 text-slate-700 transition hover:bg-slate-100" href="/dashboard/captura">
        Captura
      </Link>
    </nav>
  );
}
