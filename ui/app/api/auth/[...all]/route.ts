import { getAuth } from "@/lib/auth";

// The instance depends on admin settings (account email on or off), so it is looked up per request.
async function handler(request: Request) {
  return (await getAuth()).handler(request);
}

export { handler as GET, handler as POST };
