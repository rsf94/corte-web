export async function handleDashboardLinkToken({
  linkToken,
  hasSession,
  email,
  provider,
  requestId,
  sessionState,
  consumeLinkToken
}) {
  if (!linkToken) {
    return { handled: false, error: "" };
  }

  if (!hasSession) {
    return {
      handled: true,
      redirectTo: `/login?callbackUrl=${encodeURIComponent(`/dashboard?link_token=${encodeURIComponent(linkToken)}`)}`,
      error: ""
    };
  }

  const consumed = await consumeLinkToken(linkToken, email, provider, { requestId });
  if (consumed.ok) {
    if (sessionState) {
      sessionState.chat_id = consumed.chatId;
    }
    return { handled: true, redirectTo: "/dashboard", error: "" };
  }

  return {
    handled: true,
    error:
      consumed.error === "already_used"
        ? "Este link ya fue usado (pide uno nuevo)."
        : "Link inválido/expirado. Pide /dashboard en Telegram."
  };
}
