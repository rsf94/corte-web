export function parseAllowedEmails(value = "") {
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function getAllowedEmails() {
  return parseAllowedEmails(process.env.ALLOWED_EMAILS ?? "");
}

export function isEmailAllowed(email, allowedList = getAllowedEmails()) {
  if (!email) return false;
  if (!allowedList.length) return false;
  return allowedList.includes(email.toLowerCase());
}
