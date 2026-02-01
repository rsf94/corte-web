export function normalizeEmail(value = "") {
  return value.trim().toLowerCase();
}

export function parseAllowedEmails(value = "") {
  return value.split(",").map(normalizeEmail).filter(Boolean);
}

export function getAllowedEmails() {
  return parseAllowedEmails(
    process.env.AUTH_ALLOWED_EMAILS ?? process.env.ALLOWED_EMAILS ?? ""
  );
}

export function isEmailAllowed(email, allowedList = getAllowedEmails()) {
  const normalized = normalizeEmail(email ?? "");
  if (!normalized) return false;
  if (!allowedList.length) return false;
  return allowedList.includes(normalized);
}
