import { getServerSession } from "next-auth";
import { getAuthOptions } from "../../lib/auth.js";
import { getSessionWithE2EBypass } from "../../lib/e2e_auth_bypass.js";
import { ensureUserExistsByEmail } from "../../lib/identity_links.js";
import DashboardNav from "./dashboard-nav.js";
import DashboardSignOutButton from "./dashboard-sign-out-button.js";

export default async function DashboardLayout({ children }) {
  const session = await getSessionWithE2EBypass(() => getServerSession(getAuthOptions()));
  const sessionEmail = session?.user?.email ?? "";

  if (sessionEmail) {
    await ensureUserExistsByEmail(sessionEmail);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-6">
            <p className="text-lg font-semibold text-slate-900">Corte Dashboard</p>
            <DashboardNav />
          </div>

          <div className="flex items-center gap-3">
            {sessionEmail ? <p className="text-sm text-slate-600">{sessionEmail}</p> : null}
            <DashboardSignOutButton />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
