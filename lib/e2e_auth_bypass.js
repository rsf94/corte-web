const DEFAULT_BYPASS_EMAIL = "rafasf94@gmail.com";

export function isE2EAuthBypassEnabled({
  bypass = process.env.E2E_AUTH_BYPASS,
  nodeEnv = process.env.NODE_ENV
} = {}) {
  return bypass === "1" && nodeEnv !== "production";
}

export function getE2EBypassSession() {
  return {
    user: {
      email: DEFAULT_BYPASS_EMAIL,
      name: "E2E Bypass",
      provider: "e2e-bypass"
    }
  };
}

export async function getSessionWithE2EBypass(getSession) {
  if (isE2EAuthBypassEnabled()) {
    return getE2EBypassSession();
  }

  return getSession();
}

