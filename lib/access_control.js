import { getAllowedEmails, isEmailAllowed, normalizeEmail } from "./allowed_emails.js";

export function evaluateSessionAccess(session, allowedEmails = getAllowedEmails()) {
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
