import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/roles";
import ConfigForm from "@/components/ConfigForm";
import UserManagement from "@/components/UserManagement";

export default async function ConfigPage() {
  const current = await getCurrentUser();
  if (!current || current.role !== "admin") redirect("/");

  const supabase = await createServerSupabase();
  const { data: settings } = await supabase
    .from("app_settings")
    .select("taxas_pct, peso_desconto_pct, peso_ml_pct, peso_margem_pct")
    .eq("id", 1)
    .single();
  const { data: users } = await supabase
    .from("app_users")
    .select("id, email, role, created_at")
    .order("created_at", { ascending: true });

  return (
    <div className="max-w-3xl space-y-10">
      <div className="max-w-lg space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Configurações</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Valores globais usados no cálculo de margem e na pontuação de &quot;melhor campanha&quot;.
          </p>
        </div>
        <ConfigForm initial={settings ?? { taxas_pct: 0, peso_desconto_pct: 40, peso_ml_pct: 35, peso_margem_pct: 25 }} />
      </div>

      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">Gestão de usuários</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Admin vê e edita tudo. Usuário atualiza, vê/aprova decisões e aplica campanhas, mas não
            edita a lista de itens nem estas configurações.
          </p>
        </div>
        <UserManagement users={users ?? []} currentUserId={current.id} />
      </div>
    </div>
  );
}
