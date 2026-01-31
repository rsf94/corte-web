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
