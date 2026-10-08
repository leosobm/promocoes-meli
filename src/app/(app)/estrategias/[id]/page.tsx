import { redirect, notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/roles";
import EstrategiaForm from "@/components/EstrategiaForm";

export default async function EditarEstrategiaPage({ params }: { params: Promise<{ id: string }> }) {
  const current = await getCurrentUser();
  if (current?.role !== "admin") redirect("/");
  const { id } = await params;

  const supabase = await createServerSupabase();
  const { data: estrategia } = await supabase
    .from("estrategias")
    .select("id, nome, data_inicio, data_fim, tipo_escopo, margem_minima_pct, margem_alvo_pct, margem_tolerancia_pct")
    .eq("id", id)
    .maybeSingle();
  if (!estrategia) notFound();

  const [{ data: itens }, { data: curvas }] = await Promise.all([
    supabase.from("estrategia_itens").select("mlb").eq("estrategia_id", id),
    supabase.from("estrategia_curvas").select("curva").eq("estrategia_id", id),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Editar estratégia</h1>
      </div>
      <EstrategiaForm
        initial={{
          ...estrategia,
          mlbs: (itens ?? []).map((i) => i.mlb),
          curvas: (curvas ?? []).map((c) => c.curva),
        }}
      />
    </div>
  );
}
