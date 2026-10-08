import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { validarSobreposicao } from "@/lib/estrategias/validarSobreposicao";

const BODY_SCHEMA = z.object({
  nome: z.string().trim().min(1, "Nome obrigatório"),
  data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data_inicio inválida (use AAAA-MM-DD)"),
  data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data_fim inválida (use AAAA-MM-DD)"),
  tipo_escopo: z.enum(["item", "curva"]),
  margem_minima_pct: z.coerce.number().min(0).max(99).optional().nullable(),
  margem_alvo_pct: z.coerce.number().min(0).max(99).optional().nullable(),
  margem_tolerancia_pct: z.coerce.number().min(0).max(100).optional().nullable(),
  mlbs: z.array(z.string().trim().min(1)).optional().default([]),
  curvas: z.array(z.enum(["A", "B", "C", "D", "Lançamento"])).optional().default([]),
});

/** GET: lista todas as estratégias com contagem de alvos e status
 * calculado (agendada/ativa/encerrada) pra exibir no /estrategias. */
export async function GET() {
  const { user, response } = await requireAdmin();
  if (!user) return response;

  const supabase = createServiceSupabase();
  const { data: estrategias, error } = await supabase
    .from("estrategias")
    .select("id, nome, data_inicio, data_fim, tipo_escopo, margem_minima_pct, margem_alvo_pct, margem_tolerancia_pct, created_at")
    .order("data_inicio", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (estrategias ?? []).map((e) => e.id);
  const [{ data: itens }, { data: curvas }] = await Promise.all([
    ids.length ? supabase.from("estrategia_itens").select("estrategia_id").in("estrategia_id", ids) : Promise.resolve({ data: [] as { estrategia_id: string }[] }),
    ids.length ? supabase.from("estrategia_curvas").select("estrategia_id").in("estrategia_id", ids) : Promise.resolve({ data: [] as { estrategia_id: string }[] }),
  ]);
  const contagemPorId = new Map<string, number>();
  for (const i of itens ?? []) contagemPorId.set(i.estrategia_id, (contagemPorId.get(i.estrategia_id) ?? 0) + 1);
  for (const c of curvas ?? []) contagemPorId.set(c.estrategia_id, (contagemPorId.get(c.estrategia_id) ?? 0) + 1);

  const hoje = new Date().toISOString().slice(0, 10);
  const resultado = (estrategias ?? []).map((e) => ({
    ...e,
    total_alvos: contagemPorId.get(e.id) ?? 0,
    status: e.data_fim < hoje ? "encerrada" : e.data_inicio > hoje ? "agendada" : "ativa",
  }));

  return NextResponse.json({ estrategias: resultado });
}

/** POST: cria uma estratégia nova — valida sobreposição antes de gravar
 * (nunca duas estratégias do mesmo tipo_escopo cobrindo o mesmo item/curva
 * no mesmo período). */
export async function POST(request: NextRequest) {
  const { user, response } = await requireAdmin();
  if (!user) return response;

  const parsed = BODY_SCHEMA.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }
  const body = parsed.data;
  if (body.data_fim < body.data_inicio) {
    return NextResponse.json({ error: "data_fim não pode ser antes de data_inicio." }, { status: 400 });
  }
  const alvos = body.tipo_escopo === "item" ? body.mlbs : body.curvas;
  if (alvos.length === 0) {
    return NextResponse.json(
      { error: `Selecione ao menos um(a) ${body.tipo_escopo === "item" ? "item" : "curva"} pra essa estratégia.` },
      { status: 400 },
    );
  }

  const erroSobreposicao = await validarSobreposicao({
    tipoEscopo: body.tipo_escopo,
    alvos,
    dataInicio: body.data_inicio,
    dataFim: body.data_fim,
  });
  if (erroSobreposicao) return NextResponse.json({ error: erroSobreposicao }, { status: 409 });

  const supabase = createServiceSupabase();
  const { data: nova, error } = await supabase
    .from("estrategias")
    .insert({
      nome: body.nome,
      data_inicio: body.data_inicio,
      data_fim: body.data_fim,
      tipo_escopo: body.tipo_escopo,
      margem_minima_pct: body.margem_minima_pct ?? null,
      margem_alvo_pct: body.margem_alvo_pct ?? null,
      margem_tolerancia_pct: body.margem_tolerancia_pct ?? null,
    })
    .select("id")
    .single();
  if (error || !nova) return NextResponse.json({ error: error?.message ?? "Falha ao criar estratégia." }, { status: 500 });

  const insertAlvos = body.tipo_escopo === "item"
    ? supabase.from("estrategia_itens").insert(alvos.map((mlb) => ({ estrategia_id: nova.id, mlb })))
    : supabase.from("estrategia_curvas").insert(alvos.map((curva) => ({ estrategia_id: nova.id, curva })));
  const { error: alvosErr } = await insertAlvos;
  if (alvosErr) {
    await supabase.from("estrategias").delete().eq("id", nova.id);
    return NextResponse.json({ error: `Falha ao vincular alvos: ${alvosErr.message}` }, { status: 500 });
  }

  return NextResponse.json({ id: nova.id });
}
