import { BigQuery } from "@google-cloud/bigquery";
import { getServerSession } from "next-auth";
import { getAuthOptions } from "../../../lib/auth.js";
import { getAuthedUserContext } from "../../../lib/auth_user_context.js";
import { fetchLatestLinkedChatIdByUserId } from "../../../lib/identity_links.js";
import { fetchExpenseCaptureContext } from "../../../lib/expense_capture_context.js";

export const dynamic = "force-dynamic";

const bq = new BigQuery({
  projectId: process.env.BQ_PROJECT_ID || undefined
});

const defaultQueryFn = (options) => bq.query(options);

export async function handleExpenseCaptureContextGet(
  request,
  {
    getSession = () => getServerSession(getAuthOptions()),
    queryFn = defaultQueryFn
  } = {}
) {
  try {
    const session = await getSession();
    const authContext = await getAuthedUserContext(request, { getSession: () => session, queryFn });
    if (authContext.errorResponse) return authContext.errorResponse;

    const linkedChatId = await fetchLatestLinkedChatIdByUserId(authContext.user_id, { queryFn });
    const sessionChatId = String(session?.chat_id || session?.user?.chat_id || "").trim();
    const chatId = linkedChatId || sessionChatId;
    const context = await fetchExpenseCaptureContext({ userId: authContext.user_id, chatId }, { queryFn });

    console.log("expense_capture_context", {
      user_id: authContext.user_id,
      email: session?.user?.email || "",
      resolvedChatId: chatId || "",
      counts: context.diagnostics,
      method_labels: (context.methods || []).map((method) => method.label)
    });

    return Response.json({
      ok: true,
      methods: context.methods.map((method) => ({ id: method.id, label: method.label })),
      hasTrip: context.hasTrip,
      activeTripId: context.activeTripId,
      defaults: context.defaults,
      active_trip: context.active_trip
    });
  } catch (error) {
    return Response.json({ error: error.message || "Server error" }, { status: 500 });
  }
}

export async function GET(request) {
  return handleExpenseCaptureContextGet(request);
}
