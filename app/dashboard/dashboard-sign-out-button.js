"use client";

import { signOut } from "next-auth/react";

export default function DashboardSignOutButton() {
  return (
    <button
      className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
      type="button"
      onClick={() => signOut({ callbackUrl: "/" })}
    >
      Cerrar sesión
    </button>
  );
}
