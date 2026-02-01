import crypto from "node:crypto";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env ${name}`);
  }
  return value;
}

function signPayload(payload, secret) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function parseLinkToken(token, { now = Date.now(), secret } = {}) {
  if (!token) {
    return { valid: false, reason: "missing" };
  }

  const resolvedSecret = secret ?? requiredEnv("LINK_TOKEN_SECRET");
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, reason: "format" };
  }

  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) {
    return { valid: false, reason: "format" };
  }

  const expectedSignature = signPayload(payloadB64, resolvedSecret);
  if (!timingSafeEqualString(signature, expectedSignature)) {
    return { valid: false, reason: "signature" };
  }

  let payload;
  try {
    const json = Buffer.from(payloadB64, "base64url").toString("utf8");
    payload = JSON.parse(json);
  } catch (error) {
    return { valid: false, reason: "payload" };
  }

  const chatId = payload?.chat_id;
  const exp = Number(payload?.exp);
  if (!chatId || !Number.isFinite(exp)) {
    return { valid: false, reason: "payload" };
  }

  const nowSeconds = Math.floor(now / 1000);
  if (exp < nowSeconds) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, chatId: String(chatId), exp };
}
