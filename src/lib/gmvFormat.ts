// Sem dependências de servidor — usado pelas tabelas do Painel e do Catálogo.

export function fmtShare(v: number | null) {
  if (v == null) return "-";
  if (v === 0) return "0%";
  return v < 0.01 ? "<0,01%" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

export function fmtGmv(v: number | null) {
  return v == null ? "" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
