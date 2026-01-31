"use client";

import { useEffect } from "react";
import { signOut } from "next-auth/react";

export default function SignOutNotice() {
  useEffect(() => {
    signOut({ callbackUrl: "/login" });
  }, []);

  return (
    <p className="mt-4 text-sm text-slate-600">
      Cerrando sesión. Si esto fue un error, contacta al administrador.
    </p>
  );
}
