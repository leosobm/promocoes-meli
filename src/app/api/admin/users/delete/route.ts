import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createServiceSupabase } from "@/lib/supabase/server";

interface Body {
  userId: string;
}

/** Admin-only: exclui um usuário (auth.users — app_users cai junto via
 * ON DELETE CASCADE). Bloqueia excluir a si mesmo e excluir o último admin,
 * pra não travar o sistema sem ninguém com acesso de gestão. */
export async function POST(request: NextRequest) {
  const { user, response } = await requireAdmin();
  if (!user) return response;

  const body = (await request.json()) as Body;
  if (!body.userId) return NextResponse.json({ error: "userId obrigatório." }, { status: 400 });

  if (body.userId === user.id) {
    return NextResponse.json({ error: "Você não pode excluir a própria conta por aqui." }, { status: 400 });
  }

  const supabase = createServiceSupabase();
  const { data: target } = await supabase.from("app_users").select("role").eq("id", body.userId).maybeSingle();
  if (target?.role === "admin") {
    const { count } = await supabase
      .from("app_users")
      .select("*", { count: "exact", head: true })
      .eq("role", "admin");
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: "Não é possível excluir o último administrador." }, { status: 400 });
    }
  }

  const { error } = await supabase.auth.admin.deleteUser(body.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
