import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/roles";
import EstrategiasList from "@/components/EstrategiasList";

export default async function EstrategiasPage() {
  const current = await getCurrentUser();
  if (current?.role !== "admin") redirect("/");

  const supabase = await createServerSupabase();
  const { data: estrategias } = await supabase
    .from("estrategias")
    .select("id, nome, data_inicio, data_fim, tipo_escopo, margem_minima_pct, margem_alvo_pct, margem_tolerancia_pct")
    .order("data_inicio", { ascending: false });

  const ids = (estrategias ?? []).map((e) => e.id);
  const [{ data: itens }, { data: curvas }] = await Promise.all([
    ids.length
      ? supabase.from("estrategia_itens").select("estrategia_id").in("estrategia_id", ids)
      : Promise.resolve({ data: [] as { estrategia_id: string }[] }),
    ids.length
      ? supabase.from("estrategia_curvas").select("estrategia_id").in("estrategia_id", ids)
      : Promise.resolve({ data: [] as { estrategia_id: string }[] }),
  ]);
  const contagemPorId = new Map<string, number>();
  for (const i of itens ?? []) contagemPorId.set(i.estrategia_id, (contagemPorId.get(i.estrategia_id) ?? 0) + 1);
  for (const c of curvas ?? []) contagemPorId.set(c.estrategia_id, (contagemPorId.get(c.estrategia_id) ?? 0) + 1);

  const hoje = new Date().toISOString().slice(0, 10);
  const comStatus = (estrategias ?? []).map((e) => ({
    ...e,
    total_alvos: contagemPorId.get(e.id) ?? 0,
    status: (e.data_fim < hoje ? "encerrada" : e.data_inicio > hoje ? "agendada" : "ativa") as
      | "encerrada"
      | "agendada"
      | "ativa",
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Estratégias</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Override temporário de margem mínima, alvo e tolerância, por item ou por curva, válido
            só durante o período definido — tem prioridade sobre a margem do item/curva enquanto
            estiver ativa.
          </p>
        </div>
        <Link
          href="/estrategias/nova"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Nova estratégia
        </Link>
      </div>

      <EstrategiasList estrategias={comStatus} />
    </div>
  );
}
