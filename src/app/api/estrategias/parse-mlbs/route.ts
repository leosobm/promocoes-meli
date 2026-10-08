import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireAdmin } from "@/lib/auth/requireAdmin";

const COLUNA_MLB_ALIASES = ["mlb", "id canal", "id_canal", "anuncio", "anúncio"];

/** Só interpreta a planilha e devolve a lista de MLBs encontrados — não
 * grava nada. O formulário de estratégia junta isso com a seleção manual
 * (busca/clique) e só persiste tudo junto ao salvar a estratégia. */
export async function POST(request: NextRequest) {
  const { user, response } = await requireAdmin();
  if (!user) return response;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Nenhum arquivo enviado (campo 'file')." }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  const mlbs = new Set<string>();
  for (const raw of rawRows) {
    for (const [k, v] of Object.entries(raw)) {
      if (!COLUNA_MLB_ALIASES.includes(k.trim().toLowerCase())) continue;
      const mlb = String(v ?? "").trim().toUpperCase();
      if (mlb) mlbs.add(mlb);
      break;
    }
  }

  if (mlbs.size === 0) {
    return NextResponse.json(
      { error: "Nenhum MLB encontrado — a planilha precisa de uma coluna chamada 'mlb'." },
      { status: 400 },
    );
  }

  return NextResponse.json({ mlbs: [...mlbs] });
}
