import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * Aceita .csv ou .xlsx com as colunas (nomes flexíveis, ver COLUMN_ALIASES):
 *   mlb (ou sku), cmv, margem_minima_pct, margem_alvo_pct?, participar_campanhas?
 * Faz upsert em item_config por mlb. Não apaga itens ausentes do arquivo —
 * upload é incremental (rode de novo pra atualizar só o que mudou).
 */

const ROW_SCHEMA = z.object({
  mlb: z.string().trim().min(1, "MLB obrigatório"),
  sku: z.string().trim().optional().nullable(),
  cmv: z.coerce.number().positive("CMV deve ser > 0"),
  margem_minima_pct: z.coerce.number().min(0).max(99, "margem_minima_pct deve estar entre 0 e 99"),
  margem_alvo_pct: z.coerce.number().min(0).max(99).optional().nullable(),
  participar_campanhas: z.boolean().default(true),
});

const COLUMN_ALIASES: Record<string, string> = {
  "id canal": "mlb",
  mlb: "mlb",
  sku: "sku",
  cmv: "cmv",
  custo: "cmv",
  custo_unitario: "cmv",
  margem_minima_pct: "margem_minima_pct",
  "margem minima": "margem_minima_pct",
  margem_alvo_pct: "margem_alvo_pct",
  "margem alvo": "margem_alvo_pct",
  margem: "margem_alvo_pct",
  participar_campanhas: "participar_campanhas",
  participar: "participar_campanhas",
};

function normalizeKey(k: string): string {
  return k.trim().toLowerCase();
}

function parseBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toUpperCase();
  return !["NAO", "NÃO", "NO", "FALSE", "0", "N"].includes(s);
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Nenhum arquivo enviado (campo 'file')." }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  const errors: { linha: number; erro: string }[] = [];
  const validRows: { linha: number; data: z.infer<typeof ROW_SCHEMA> }[] = [];

  rawRows.forEach((raw, idx) => {
    const mapped: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      const alias = COLUMN_ALIASES[normalizeKey(k)];
      if (alias) mapped[alias] = v;
    }
    if (mapped.participar_campanhas !== undefined) {
      mapped.participar_campanhas = parseBool(mapped.participar_campanhas);
    }
    if (mapped.margem_alvo_pct === "") mapped.margem_alvo_pct = undefined;
    if (mapped.sku === "") mapped.sku = undefined;

    const parsed = ROW_SCHEMA.safeParse(mapped);
    if (!parsed.success) {
      errors.push({ linha: idx + 2, erro: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    validRows.push({ linha: idx + 2, data: parsed.data });
  });

  if (validRows.length === 0) {
    return NextResponse.json(
      { error: "Nenhuma linha válida encontrada.", errors },
      { status: 400 },
    );
  }

  // Postgres rejeita upsert em lote com o mesmo valor de conflito (mlb)
  // repetido na mesma chamada ("ON CONFLICT DO UPDATE command cannot affect
  // row a second time") — se o arquivo tiver o mesmo MLB em mais de uma
  // linha, mantém só a ÚLTIMA ocorrência (linha mais abaixo na planilha
  // "vence") e avisa nos warnings quais linhas foram descartadas por isso.
  const byMlb = new Map<string, { linha: number; data: z.infer<typeof ROW_SCHEMA> }>();
  const duplicatas: { linha: number; erro: string }[] = [];
  for (const row of validRows) {
    const anterior = byMlb.get(row.data.mlb);
    if (anterior) {
      duplicatas.push({
        linha: anterior.linha,
        erro: `MLB ${anterior.data.mlb} duplicado no arquivo — usada a linha ${row.linha} (mais abaixo), esta foi ignorada.`,
      });
    }
    byMlb.set(row.data.mlb, row);
  }
  const dedupedRows = [...byMlb.values()].map((r) => r.data);

  const supabase = createServiceSupabase();
  const { error } = await supabase.from("item_config").upsert(
    dedupedRows.map((r) => ({
      mlb: r.mlb,
      sku: r.sku ?? null,
      cmv: r.cmv,
      margem_minima_pct: r.margem_minima_pct,
      margem_alvo_pct: r.margem_alvo_pct ?? null,
      participar_campanhas: r.participar_campanhas,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "mlb" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ imported: dedupedRows.length, errors: [...errors, ...duplicatas] });
}
