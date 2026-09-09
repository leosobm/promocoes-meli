import { NextResponse } from "next/server";
import { getCurrentUser, type CurrentUser } from "./roles";

export async function requireAdmin(): Promise<
  { user: CurrentUser; response: null } | { user: null; response: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return {
      user: null,
      response: NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 }),
    };
  }
  return { user, response: null };
}
