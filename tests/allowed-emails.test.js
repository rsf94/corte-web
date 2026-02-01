import assert from "node:assert/strict";
import test from "node:test";
import { isEmailAllowed, parseAllowedEmails } from "../lib/allowed_emails.js";

test("parseAllowedEmails trims, lowercases, and filters empty entries", () => {
  const list = parseAllowedEmails("  Uno@Mail.com , , DOS@mail.com ");
  assert.deepEqual(list, ["uno@mail.com", "dos@mail.com"]);
});

test("isEmailAllowed checks membership case-insensitively", () => {
  const allowedList = ["persona@correo.com"];
  assert.equal(isEmailAllowed("Persona@Correo.com", allowedList), true);
  assert.equal(isEmailAllowed("otro@correo.com", allowedList), false);
});

test("isEmailAllowed matches after trimming and lowercasing allowlist entries", () => {
  const allowedList = parseAllowedEmails("  RafaSF94@Gmail.com ");
  assert.equal(isEmailAllowed("rafasf94@gmail.com", allowedList), true);
});

test("isEmailAllowed denies when allowlist is missing", () => {
  assert.equal(isEmailAllowed("persona@correo.com", []), false);
});
