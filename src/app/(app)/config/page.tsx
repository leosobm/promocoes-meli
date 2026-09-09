import { createServerSupabase } from "@/lib/supabase/server";
import ConfigForm from "@/components/ConfigForm";

export default async function ConfigPage() {
  const supabase = await createServerSupabase();
  const { data: settings } = await supabase
    .from("app_settings")
    .select("taxas_pct, peso_desconto_pct, peso_ml_pct, peso_margem_pct")
    .eq("id", 1)
    .single();

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Configurações</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Valores globais usados no cálculo de margem e na pontuação de &quot;melhor campanha&quot;.
        </p>
      </div>
      <ConfigForm initial={settings ?? { taxas_pct: 0, peso_desconto_pct: 40, peso_ml_pct: 35, peso_margem_pct: 25 }} />
    </div>
  );
}
