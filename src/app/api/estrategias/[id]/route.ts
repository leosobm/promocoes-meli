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

/** GET: detalhe de uma estratégia, com a lista completa de alvos (pra
 * popular o formulário de edição). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireAdmin();
  if (!user) return response;
  const { id } = await params;

  const supabase = createServiceSupabase();
  const { data: estrategia, error } = await supabase
    .from("estrategias")
    .select("id, nome, data_inicio, data_fim, tipo_escopo, margem_minima_pct, margem_alvo_pct, margem_tolerancia_pct")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!estrategia) return NextResponse.json({ error: "Estratégia não encontrada." }, { status: 404 });

  const [{ data: itens }, { data: curvas }] = await Promise.all([
    supabase.from("estrategia_itens").select("mlb").eq("estrategia_id", id),
    supabase.from("estrategia_curvas").select("curva").eq("estrategia_id", id),
  ]);

  return NextResponse.json({
    ...estrategia,
    mlbs: (itens ?? []).map((i) => i.mlb),
    curvas: (curvas ?? []).map((c) => c.curva),
  });
}

/** PUT: atualiza nome/período/margens e SUBSTITUI a lista de alvos
 * inteira pela enviada — o formulário sempre manda o conjunto completo
 * (mais simples que add/remove incremental). Revalida sobreposição
 * ignorando a própria estratégia. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireAdmin();
  if (!user) return response;
  const { id } = await params;

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
    ignorarEstrategiaId: id,
  });
  if (erroSobreposicao) return NextResponse.json({ error: erroSobreposicao }, { status: 409 });

  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("estrategias")
    .update({
      nome: body.nome,
      data_inicio: body.data_inicio,
      data_fim: body.data_fim,
      tipo_escopo: body.tipo_escopo,
      margem_minima_pct: body.margem_minima_pct ?? null,
      margem_alvo_pct: body.margem_alvo_pct ?? null,
      margem_tolerancia_pct: body.margem_tolerancia_pct ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Substitui os alvos: apaga os dois tipos (caso tenha trocado de
  // tipo_escopo numa edição) e reinsere só o conjunto atual.
  await Promise.all([
    supabase.from("estrategia_itens").delete().eq("estrategia_id", id),
    supabase.from("estrategia_curvas").delete().eq("estrategia_id", id),
  ]);
  const insertAlvos = body.tipo_escopo === "item"
    ? supabase.from("estrategia_itens").insert(alvos.map((mlb) => ({ estrategia_id: id, mlb })))
    : supabase.from("estrategia_curvas").insert(alvos.map((curva) => ({ estrategia_id: id, curva })));
  const { error: alvosErr } = await insertAlvos;
  if (alvosErr) return NextResponse.json({ error: `Falha ao vincular alvos: ${alvosErr.message}` }, { status: 500 });

  return NextResponse.json({ ok: true });
}

/** DELETE: remove a estratégia (estrategia_itens/estrategia_curvas somem
 * junto, via ON DELETE CASCADE). */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await requireAdmin();
  if (!user) return response;
  const { id } = await params;

  const supabase = createServiceSupabase();
  const { error } = await supabase.from("estrategias").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
