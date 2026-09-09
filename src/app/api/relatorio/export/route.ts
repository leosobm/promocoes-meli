import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { createServerSupabase } from "@/lib/supabase/server";
import { getLatestRunReport, type DecisionReportRow } from "@/lib/reportData";

function toSheetRows(rows: DecisionReportRow[]) {
  return rows.map((r) => ({
    MLB: r.mlb,
    Título: r.title ?? "",
    Campanha: r.promotion_type,
    "ID Campanha": r.promotion_id ?? "",
    "Preço Original (R$)": r.preco_original ?? "",
    "Preço Proposto (R$)": r.preco_proposto ?? "",
    "Desconto (%)": r.desconto_consumidor_pct ?? "",
    "Margem (%)": r.margem_calculada_pct ?? "",
    Score: r.score ?? "",
    Status: r.status,
    Motivo: r.motivo,
    "Calculado em": r.created_at,
    "Aplicado em": r.applied_at ?? "",
  }));
}

function addSheet(wb: XLSX.WorkBook, name: string, rows: DecisionReportRow[]) {
  const ws = XLSX.utils.json_to_sheet(toSheetRows(rows));
  ws["!cols"] = [
    { wch: 16 }, { wch: 30 }, { wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
    { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 50 }, { wch: 20 }, { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
}

/** Protegida pelo middleware (qualquer usuário logado — exportar é uma
 * ação de revisão, não de edição). Exporta o relatório da rodada mais
 * recente (ou de uma rodada específica via ?runId=). */
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase();
  const runId = request.nextUrl.searchParams.get("runId") ?? undefined;
  const report = await getLatestRunReport(supabase, runId);

  const wb = XLSX.utils.book_new();
  const resumoWs = XLSX.utils.json_to_sheet([
    { Métrica: "Rodada (run_id)", Valor: report.runId ?? "-" },
    { Métrica: "Data/hora", Valor: report.createdAt ? new Date(report.createdAt).toLocaleString("pt-BR") : "-" },
    { Métrica: "Itens processados", Valor: report.totalItens },
    { Métrica: "Aderido", Valor: report.aderido.length },
    { Métrica: "Para revisão", Valor: report.paraRevisao.length },
    { Métrica: "Não aderido", Valor: report.naoAderido.length },
  ]);
  resumoWs["!cols"] = [{ wch: 20 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, resumoWs, "Resumo");

  addSheet(wb, "Aderido", report.aderido);
  addSheet(wb, "Para revisão", report.paraRevisao);
  addSheet(wb, "Não aderido", report.naoAderido);

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="relatorio_campanhas_${stamp}.xlsx"`,
    },
  });
}
