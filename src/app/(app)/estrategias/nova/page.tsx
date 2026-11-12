import { redirect, notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/roles";
import { hojeBrasilia } from "@/lib/timezone";
import EstrategiaForm, { type EstrategiaInitial } from "@/components/EstrategiaForm";

/** Soma `dias` a uma data "YYYY-MM-DD" em aritmética UTC (sem hora),
 * evitando qualquer problema de fuso horário na conta. */
function somarDias(dataISO: string, dias: number): string {
  const data = new Date(`${dataISO}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

function diffDias(inicioISO: string, fimISO: string): number {
  const inicio = new Date(`${inicioISO}T00:00:00Z`).getTime();
  const fim = new Date(`${fimISO}T00:00:00Z`).getTime();
  return Math.round((fim - inicio) / 86_400_000);
}

export default async function NovaEstrategiaPage({
  searchParams,
}: {
  searchParams: Promise<{ duplicar?: string }>;
}) {
  const current = await getCurrentUser();
  if (current?.role !== "admin") redirect("/");

  const { duplicar } = await searchParams;

  let initial: EstrategiaInitial | undefined;
  if (duplicar) {
    const supabase = await createServerSupabase();
    const { data: origem } = await supabase
      .from("estrategias")
      .select("nome, data_inicio, data_fim, tipo_escopo, margem_minima_pct, margem_alvo_pct, margem_teto_pct, margem_tolerancia_pct")
      .eq("id", duplicar)
      .maybeSingle();
    if (!origem) notFound();

    const [{ data: itens }, { data: curvas }] = await Promise.all([
      supabase.from("estrategia_itens").select("mlb").eq("estrategia_id", duplicar),
      supabase.from("estrategia_curvas").select("curva").eq("estrategia_id", duplicar),
    ]);

    // Mesma duração (em dias) da estratégia original, mas começando hoje —
    // ex.: original de 30 dias duplicada hoje vira hoje até daqui 30 dias.
    const duracaoDias = diffDias(origem.data_inicio, origem.data_fim);
    const novoInicio = hojeBrasilia();
    const novoFim = somarDias(novoInicio, duracaoDias);

    initial = {
      nome: `${origem.nome} (cópia)`,
      data_inicio: novoInicio,
      data_fim: novoFim,
      tipo_escopo: origem.tipo_escopo,
      margem_minima_pct: origem.margem_minima_pct,
      margem_alvo_pct: origem.margem_alvo_pct,
      margem_teto_pct: origem.margem_teto_pct,
      margem_tolerancia_pct: origem.margem_tolerancia_pct,
      mlbs: (itens ?? []).map((i) => i.mlb),
      curvas: (curvas ?? []).map((c) => c.curva),
    };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">
          {duplicar ? "Duplicar estratégia" : "Nova estratégia"}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {duplicar
            ? "Mesmos dados da estratégia original, com o período ajustado pra começar hoje (mesma duração em dias). Revise e confirme antes de criar."
            : "Define um período e uma margem mínima/alvo/tolerância que prevalece sobre o item/curva enquanto durar."}
        </p>
      </div>
      <EstrategiaForm initial={initial} />
    </div>
  );
}
