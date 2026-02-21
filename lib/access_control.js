import { getAllowedEmails, isEmailAllowed, normalizeEmail } from "./allowed_emails.js";
import { isE2EAuthBypassEnabled } from "./e2e_auth_bypass.js";

export function evaluateSessionAccess(session, allowedEmails = getAllowedEmails()) {
  if (isE2EAuthBypassEnabled()) {
    const email = normalizeEmail(session?.user?.email ?? "rafasf94@gmail.com");
    return { status: "ok", email };
  }

  if (!session) {
    return { status: "missing_session", email: "" };
  }

  if (!allowedEmails.length) {
    return { status: "missing_allowlist", email: "" };
  }

  const email = normalizeEmail(session.user?.email ?? "");
  if (!isEmailAllowed(email, allowedEmails)) {
    return { status: "email_not_allowed", email };
  }

  return { status: "ok", email };
}

export function getDashboardRedirect({ sessionStatus, usingTokenFallback }) {
  if (sessionStatus === "missing_session") {
    return usingTokenFallback ? null : "/login";
  }

  if (sessionStatus !== "ok") {
    return "/unauthorized";
  }

  return null;
}
