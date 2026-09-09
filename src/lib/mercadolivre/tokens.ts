import { createServiceSupabase } from "@/lib/supabase/server";
import type { MLTokens } from "./types";

/** ml_tokens não tem policy de RLS para authenticated/anon — só o backend,
 * usando a service_role key, consegue ler/gravar essa tabela. */
export async function getStoredTokens(): Promise<MLTokens | null> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("ml_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data || !data.access_token) return null;
  return data as MLTokens;
}

/** "Conectado" = tem access_token salvo, mesmo sem refresh_token (o ML nem
 * sempre devolve um — nesse caso o app usa o access_token até expirar e
 * pede pra reconectar depois, em vez de esconder a tela inteira). */
export async function isConnected(): Promise<boolean> {
  const tokens = await getStoredTokens();
  return !!tokens?.access_token;
}

/** Verdadeiro só quando dá pra renovar sozinho (tem refresh_token) — usado
 * pra avisar na tela, sem bloquear o uso enquanto o access_token durar. */
export async function hasAutoRefresh(): Promise<boolean> {
  const tokens = await getStoredTokens();
  return !!tokens?.refresh_token;
}

export async function saveTokens(
  accessToken: string,
  refreshToken: string,
  expiresInSeconds: number | null,
): Promise<void> {
  const supabase = createServiceSupabase();
  const expiresAt = expiresInSeconds
    ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
    : null;
  const { error } = await supabase.from("ml_tokens").upsert({
    id: 1,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Falha ao salvar tokens: ${error.message}`);
}
