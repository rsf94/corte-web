import crypto from "node:crypto";
import { normalizeEmail } from "./allowed_emails.js";

function hashEmail(email) {
  return crypto.createHash("sha256").update(email).digest("hex").slice(0, 12);
}

export function logAccessDenied({ reason, email = "", path }) {
  const normalized = normalizeEmail(email);
  const payload = normalized
    ? { reason, email_hash: hashEmail(normalized), path }
    : { reason, email_domain: "unknown", path };
  console.warn("[access_denied]", payload);
}
