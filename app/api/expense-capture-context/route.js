import { BigQuery } from "@google-cloud/bigquery";
import { getServerSession } from "next-auth";
import { getAuthOptions } from "../../../lib/auth.js";
import { getSessionWithE2EBypass } from "../../../lib/e2e_auth_bypass.js";
import { getAuthedUserContext } from "../../../lib/auth_user_context.js";
import { resolveChatIdForUser } from "../../../lib/identity_links.js";
import { fetchExpenseCaptureContext } from "../../../lib/expense_capture_context.js";

export const dynamic = "force-dynamic";

const bq = new BigQuery({
  projectId: process.env.BQ_PROJECT_ID || undefined
});

const defaultQueryFn = (options) => bq.query(options);

function isDevOrTest() {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
}

function buildDiagnosticPayload({ userId, chatId, context, fallbackError = "" }) {
  return {
    resolved_user_id: userId || "",
    resolved_chat_id: chatId || "",
    bq_dataset: process.env.BQ_DATASET || "",
    methods_count_accounts_user: context?.diagnostics?.methods_count_accounts_user ?? 0,
    methods_count_accounts_chat: context?.diagnostics?.methods_count_accounts_chat ?? 0,
    methods_count_card_rules_user: context?.diagnostics?.methods_count_card_rules_user ?? 0,
    methods_count_card_rules_chat: context?.diagnostics?.methods_count_card_rules_chat ?? 0,
    final_methods_count: context?.diagnostics?.final_methods_count ?? 0,
    query_status: context?.diagnostics?.query_status ?? {},
    error: fallbackError || ""
  };
}

export async function handleExpenseCaptureContextGet(
  request,
  {
    getSession = () => getSessionWithE2EBypass(() => getServerSession(getAuthOptions())),
    queryFn = defaultQueryFn
  } = {}
) {
  const diagnostics = {
    resolved_user_id: "",
    resolved_chat_id: "",
    bq_dataset: process.env.BQ_DATASET || "",
    methods_count_accounts_user: 0,
    methods_count_accounts_chat: 0,
    methods_count_card_rules_user: 0,
    methods_count_card_rules_chat: 0,
    final_methods_count: 0,
    query_status: {},
    error: ""
  };

  try {
    const session = await getSession();
    const authContext = await getAuthedUserContext(request, { getSession: () => session, queryFn });
    if (authContext.errorResponse) return authContext.errorResponse;

    const resolvedChatId = await resolveChatIdForUser(authContext.user_id, { queryFn });
    const context = await fetchExpenseCaptureContext({ userId: authContext.user_id, chatId: resolvedChatId }, { queryFn });

    const diagnosticPayload = buildDiagnosticPayload({
      userId: authContext.user_id,
      chatId: resolvedChatId,
      context
    });

    if (isDevOrTest()) {
      console.log("expense_capture_context", diagnosticPayload);
    }

    return Response.json({
      ok: true,
      methods: context.methods.map((method) => ({ id: method.id, label: method.label })),
      hasTrip: context.hasTrip,
      activeTripId: context.activeTripId,
      defaults: context.defaults,
      active_trip: context.active_trip,
      diagnostics: isDevOrTest() ? diagnosticPayload : undefined
    });
  } catch (error) {
    diagnostics.error = String(error?.message || "Server error");

    if (isDevOrTest()) {
      console.log("expense_capture_context", diagnostics);
    }

    return Response.json({
      ok: false,
      methods: [],
      hasTrip: false,
      activeTripId: null,
      defaults: {
        includeTripByDefault: false,
        source_counts: { user: 0, chat: 0, merged: 0 }
      },
      active_trip: null,
      diagnostics: isDevOrTest() ? diagnostics : undefined
    });
  }
}

export async function GET(request) {
  return handleExpenseCaptureContextGet(request);
}
