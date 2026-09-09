import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createServiceSupabase } from "@/lib/supabase/server";

interface Body {
  userId: string;
  role: "admin" | "usuario";
}

/** Admin-only: muda o papel de um usuário. Bloqueia rebaixar o último
 * admin (inclusive a si mesmo), pra não travar o sistema sem ninguém com
 * acesso de gestão. */
export async function POST(request: NextRequest) {
  const { user, response } = await requireAdmin();
  if (!user) return response;

  const body = (await request.json()) as Body;
  if (!body.userId || (body.role !== "admin" && body.role !== "usuario")) {
    return NextResponse.json({ error: "userId e role ('admin'|'usuario') são obrigatórios." }, { status: 400 });
  }

  const supabase = createServiceSupabase();
  const { data: target } = await supabase.from("app_users").select("role").eq("id", body.userId).maybeSingle();

  if (target?.role === "admin" && body.role !== "admin") {
    const { count } = await supabase
      .from("app_users")
      .select("*", { count: "exact", head: true })
      .eq("role", "admin");
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: "Não é possível rebaixar o último administrador." }, { status: 400 });
    }
  }

  const { error } = await supabase
    .from("app_users")
    .update({ role: body.role, updated_at: new Date().toISOString() })
    .eq("id", body.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
