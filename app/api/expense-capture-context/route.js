import { BigQuery } from "@google-cloud/bigquery";
import { getServerSession } from "next-auth";
import { getAuthOptions } from "../../../lib/auth.js";
import { getSessionWithE2EBypass } from "../../../lib/e2e_auth_bypass.js";
import { getAuthedUserContext } from "../../../lib/auth_user_context.js";
import { fetchLatestLinkedChatIdByUserId } from "../../../lib/identity_links.js";
import { fetchExpenseCaptureContext } from "../../../lib/expense_capture_context.js";

export const dynamic = "force-dynamic";

const bq = new BigQuery({
  projectId: process.env.BQ_PROJECT_ID || undefined
});

const defaultQueryFn = (options) => bq.query(options);

function isDevOrTest() {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
}

export async function handleExpenseCaptureContextGet(
  request,
  {
    getSession = () => getSessionWithE2EBypass(() => getServerSession(getAuthOptions())),
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

    if (isDevOrTest()) {
      console.log("expense_capture_context", {
        resolved_user_id: authContext.user_id,
        resolved_chat_id: chatId || "",
        methods_count_user: context.diagnostics?.methods_user_id ?? 0,
        methods_count_chat: context.diagnostics?.methods_chat_id ?? 0,
        methods_final_count: context.diagnostics?.methods_merged ?? 0
      });
    }

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
