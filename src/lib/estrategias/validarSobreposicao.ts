import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * Garante a regra de negócio "nunca duas estratégias sobrepostas pro mesmo
 * item e/ou curva no mesmo período" — só compara estratégias do MESMO
 * tipo_escopo (item com item, curva com curva); uma estratégia por item e
 * uma por curva podem coexistir pro mesmo item no mesmo período (a de item
 * tem prioridade na hora de calcular, ver decisionEngine.ts).
 * Retorna uma mensagem de erro (pronta pra mostrar ao usuário) quando há
 * conflito, ou null quando está livre pra salvar.
 */
export async function validarSobreposicao(params: {
  tipoEscopo: "item" | "curva";
  alvos: string[]; // mlbs ou curvas, conforme tipoEscopo
  dataInicio: string; // YYYY-MM-DD
  dataFim: string; // YYYY-MM-DD
  ignorarEstrategiaId?: string; // ao editar, exclui a própria estratégia da checagem
}): Promise<string | null> {
  const { tipoEscopo, alvos, dataInicio, dataFim, ignorarEstrategiaId } = params;
  if (alvos.length === 0) return null;

  const supabase = createServiceSupabase();
  let query = supabase
    .from("estrategias")
    .select("id, nome, data_inicio, data_fim")
    .eq("tipo_escopo", tipoEscopo)
    .lte("data_inicio", dataFim)
    .gte("data_fim", dataInicio);
  if (ignorarEstrategiaId) query = query.neq("id", ignorarEstrategiaId);

  const { data: candidatas, error } = await query;
  if (error) return `Falha ao validar sobreposição: ${error.message}`;
  if (!candidatas || candidatas.length === 0) return null;

  const tabelaAlvo = tipoEscopo === "item" ? "estrategia_itens" : "estrategia_curvas";
  const colunaAlvo = tipoEscopo === "item" ? "mlb" : "curva";
  const idsCandidatas = candidatas.map((c) => c.id);

  const { data: vinculos, error: vinculosErr } = await supabase
    .from(tabelaAlvo)
    .select(`estrategia_id, ${colunaAlvo}`)
    .in("estrategia_id", idsCandidatas);
  if (vinculosErr) return `Falha ao validar sobreposição: ${vinculosErr.message}`;

  const alvosSet = new Set(alvos);
  const porEstrategia = new Map<string, string[]>();
  for (const v of (vinculos ?? []) as Record<string, string>[]) {
    const valor = v[colunaAlvo];
    if (!alvosSet.has(valor)) continue;
    const lista = porEstrategia.get(v.estrategia_id) ?? [];
    lista.push(valor);
    porEstrategia.set(v.estrategia_id, lista);
  }

  const conflitos: string[] = [];
  for (const cand of candidatas) {
    const sobrepostos = porEstrategia.get(cand.id);
    if (sobrepostos && sobrepostos.length > 0) {
      const alvoLabel = tipoEscopo === "item" ? "item(ns)" : "curva(s)";
      conflitos.push(
        `"${cand.nome}" (${cand.data_inicio} a ${cand.data_fim}) já cobre ${alvoLabel} ${sobrepostos.join(", ")} nesse período`,
      );
    }
  }

  if (conflitos.length === 0) return null;
  return `Sobreposição de estratégias: ${conflitos.join("; ")}.`;
}
