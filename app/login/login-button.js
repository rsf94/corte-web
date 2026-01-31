"use client";

import { signIn } from "next-auth/react";

export default function LoginButton() {
  return (
    <button
      className="mt-6 inline-flex items-center justify-center rounded bg-slate-900 px-6 py-3 text-sm font-medium text-white"
      type="button"
      onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
    >
      Continuar con Google
    </button>
  );
}
