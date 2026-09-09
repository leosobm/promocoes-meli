import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * Aceita .csv ou .xlsx com as colunas (nomes flexíveis, ver COLUMN_ALIASES):
 *   mlb, sku?, cmv, margem_minima_pct, margem_alvo_pct?, participar_campanhas?
 * Faz upsert em item_config pela chave composta (mlb, sku) — um MLB pode
 * aparecer em várias linhas, uma por SKU/variação (a API de Promoções do ML
 * grava o preço promocional a nível de MLB, não de variação, então o motor
 * de decisão usa a pior margem entre as variações do mesmo MLB pra decidir
 * se uma campanha é segura pro anúncio inteiro — ver decisionEngine.ts).
 * Não apaga itens ausentes do arquivo — upload é incremental.
 */

const ROW_SCHEMA = z.object({
  mlb: z.string().trim().min(1, "MLB obrigatório"),
  sku: z.string().trim().default(""),
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

  // Postgres rejeita upsert em lote com a mesma chave de conflito repetida
  // ("ON CONFLICT DO UPDATE command cannot affect row a second time"). A
  // chave aqui é (mlb, sku) — MLBs repetidos com SKUs DIFERENTES são
  // variações legítimas e todos entram; só (mlb, sku) exatamente iguais
  // contam como duplicata real (provável erro na planilha).
  const byKey = new Map<string, { linha: number; data: z.infer<typeof ROW_SCHEMA> }>();
  const duplicatas: { linha: number; erro: string }[] = [];
  for (const row of validRows) {
    const key = `${row.data.mlb}::${row.data.sku}`;
    const anterior = byKey.get(key);
    if (anterior) {
      const skuTxt = row.data.sku ? `SKU '${row.data.sku}'` : "sem SKU";
      duplicatas.push({
        linha: anterior.linha,
        erro: `MLB ${anterior.data.mlb} (${skuTxt}) duplicado no arquivo — usada a linha ${row.linha} (mais abaixo), esta foi ignorada.`,
      });
    }
    byKey.set(key, row);
  }
  const dedupedRows = [...byKey.values()].map((r) => r.data);

  const supabase = createServiceSupabase();
  const { error } = await supabase.from("item_config").upsert(
    dedupedRows.map((r) => ({
      mlb: r.mlb,
      sku: r.sku,
      cmv: r.cmv,
      margem_minima_pct: r.margem_minima_pct,
      margem_alvo_pct: r.margem_alvo_pct ?? null,
      participar_campanhas: r.participar_campanhas,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "mlb,sku" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ imported: dedupedRows.length, errors: [...errors, ...duplicatas] });
}
