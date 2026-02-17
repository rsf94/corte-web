import { normalizeEmail } from "./allowed_emails.js";
import { ensureUserExistsByEmail } from "./identity_links.js";

export async function getAuthedUserContext(
  request,
  {
    getSession,
    queryFn
  }
) {
  const session = await getSession();
  if (!session) {
    return { errorResponse: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const email = normalizeEmail(session.user?.email ?? "");
  if (!email) {
    return { errorResponse: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const ensured = await ensureUserExistsByEmail(email, { queryFn });
  if (!ensured.userId) {
    return { errorResponse: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  return {
    email,
    user_id: ensured.userId,
    requestPath: new URL(request.url).pathname
  };
}
