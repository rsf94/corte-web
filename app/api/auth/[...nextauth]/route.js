import NextAuth from "next-auth";
import { getAuthOptions } from "../../../../lib/auth.js";

const handler = NextAuth(getAuthOptions());

export { handler as GET, handler as POST };
