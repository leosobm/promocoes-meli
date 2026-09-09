import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { createServiceSupabase } from "@/lib/supabase/server";

interface Body {
  email: string;
}

/** Admin-only: dispara um e-mail de reset de senha pra outro usuário. */
export async function POST(request: NextRequest) {
  const { user, response } = await requireAdmin();
  if (!user) return response;

  const body = (await request.json()) as Body;
  const email = body.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "E-mail obrigatório." }, { status: 400 });

  const supabase = createServiceSupabase();
  const origin = request.nextUrl.origin;
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/definir-senha`,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
