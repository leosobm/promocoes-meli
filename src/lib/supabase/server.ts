import { createServerClient } from "@supabase/ssr";
import { createClient as createRawClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Cliente Supabase para uso em Server Components / Route Handlers, com a
 * sessão do usuário logado (respeita RLS como o usuário autenticado).
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // chamado de um Server Component sem permissão de escrita —
            // o middleware já cuida de renovar a sessão nesses casos.
          }
        },
      },
    },
  );
}

/**
 * Cliente com a service_role key — ignora RLS. Só pode ser usado em código
 * que roda no servidor (route handlers), nunca exposto ao browser. Usado
 * para acessar ml_tokens (sem policy de RLS para authenticated/anon) e para
 * operações administrativas.
 */
export function createServiceSupabase() {
  return createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
