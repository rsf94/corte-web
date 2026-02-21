import { BigQuery } from "@google-cloud/bigquery";
import { getServerSession } from "next-auth";
import { getAuthOptions } from "../../../lib/auth.js";
import { getAuthedUserContext } from "../../../lib/auth_user_context.js";
import { fetchExpenseCaptureContextByUserId } from "../../../lib/expense_capture_context.js";

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
    const authContext = await getAuthedUserContext(request, { getSession, queryFn });
    if (authContext.errorResponse) return authContext.errorResponse;

    const context = await fetchExpenseCaptureContextByUserId(authContext.user_id, { queryFn });
    return Response.json({ ok: true, ...context });
  } catch (error) {
    return Response.json({ error: error.message || "Server error" }, { status: 500 });
  }
}

export async function GET(request) {
  return handleExpenseCaptureContextGet(request);
}
