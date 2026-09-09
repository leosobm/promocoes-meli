import { createServerSupabase } from "@/lib/supabase/server";

export type Role = "admin" | "usuario";

export interface CurrentUser {
  id: string;
  email: string;
  role: Role;
}

/** Usuário logado + papel (app_users.role). null se não estiver logado.
 * Usa o cliente autenticado (RLS) — a policy "self or admin pode ver"
 * garante que qualquer usuário logado consegue ler a PRÓPRIA linha. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from("app_users").select("role").eq("id", user.id).maybeSingle();
  return {
    id: user.id,
    email: user.email ?? "",
    role: (data?.role as Role) ?? "usuario",
  };
}
