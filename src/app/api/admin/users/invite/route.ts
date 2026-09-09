import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createServiceSupabase } from "@/lib/supabase/server";

interface Body {
  email: string;
  role: "admin" | "usuario";
}

/** Admin-only: convida um novo usuário por e-mail. O Mercado Livre... não,
 * o SUPABASE manda o e-mail com um link — quem clica cai em /definir-senha,
 * escolhe a própria senha e já entra com o papel definido aqui. */
export async function POST(request: NextRequest) {
  const { user, response } = await requireAdmin();
  if (!user) return response;

  const body = (await request.json()) as Body;
  const email = body.email?.trim().toLowerCase();
  const role = body.role;
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  }
  if (role !== "admin" && role !== "usuario") {
    return NextResponse.json({ error: "role deve ser 'admin' ou 'usuario'." }, { status: 400 });
  }

  const supabase = createServiceSupabase();
  const origin = request.nextUrl.origin;
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/definir-senha`,
  });
  if (error || !data.user) {
    return NextResponse.json({ error: error?.message ?? "Falha ao convidar usuário." }, { status: 500 });
  }

  const { error: upsertError } = await supabase
    .from("app_users")
    .upsert({ id: data.user.id, email, role, updated_at: new Date().toISOString() });
  if (upsertError) {
    return NextResponse.json({ error: `Convite enviado, mas falhou ao salvar o papel: ${upsertError.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, userId: data.user.id });
}
