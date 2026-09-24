import * as XLSX from "xlsx";

/** Rota protegida pelo middleware — gera o modelo .xlsx de upload de itens,
 * com uma aba de exemplo e outra explicando cada coluna. */
export async function GET() {
  const wb = XLSX.utils.book_new();

  const modeloRows = [
    {
      mlb: "MLB1234567890",
      sku: "CAMISETA-AZUL-M",
      cmv: 45.9,
      margem_minima_pct: 12,
      margem_alvo_pct: 20,
      participar_campanhas: "SIM",
    },
    {
      // Mesmo MLB da linha acima, variação diferente (mesmo anúncio, outra
      // cor/tamanho) — repita o MLB, um SKU por linha, cada um com seu
      // próprio custo. O sistema usa a variação de maior custo como
      // referência de segurança na hora de decidir a campanha.
      mlb: "MLB1234567890",
      sku: "CAMISETA-AZUL-G",
      cmv: 49.9,
      margem_minima_pct: 12,
      margem_alvo_pct: 20,
      participar_campanhas: "SIM",
    },
    {
      mlb: "MLB9876543210",
      sku: "",
      cmv: 120,
      margem_minima_pct: 15,
      margem_alvo_pct: "",
      participar_campanhas: "SIM",
    },
    {
      // Sem margem própria — usa a margem mínima/alvo geral do sistema,
      // definida em Configurações.
      mlb: "MLB5555555555",
      sku: "",
      cmv: 30,
      margem_minima_pct: "",
      margem_alvo_pct: "",
      participar_campanhas: "SIM",
    },
  ];
  const wsModelo = XLSX.utils.json_to_sheet(modeloRows, {
    header: ["mlb", "sku", "cmv", "margem_minima_pct", "margem_alvo_pct", "participar_campanhas"],
  });
  wsModelo["!cols"] = [
    { wch: 18 }, { wch: 20 }, { wch: 10 }, { wch: 18 }, { wch: 16 }, { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, wsModelo, "Modelo");

  const instrucoes = [
    {
      Coluna: "mlb",
      "Obrigatório?": "Sim",
      Descrição:
        "Identificador do anúncio no Mercado Livre. Item COM variação (cor/tamanho etc.): repita o mesmo mlb numa linha por SKU — o Mercado Livre grava o preço promocional a nível de anúncio inteiro, não por variação, então o sistema usa a variação de MAIOR custo (menor margem) como referência de segurança antes de aceitar qualquer campanha pra esse MLB.",
      "Formato / Exemplo": "MLB1234567890",
    },
    {
      Coluna: "sku",
      "Obrigatório?": "Não (mas obrigatório se o mlb tiver mais de uma linha)",
      Descrição:
        "Seu código interno (SELLER_SKU) da variação. Precisa bater exatamente com o SELLER_SKU cadastrado naquela variação no Mercado Livre — se não bater, o sistema avisa no log e usa o preço do anúncio inteiro como aproximação.",
      "Formato / Exemplo": "CAMISETA-AZUL-M",
    },
    {
      Coluna: "cmv",
      "Obrigatório?": "Sim",
      Descrição: "Custo da mercadoria vendida — o custo do produto em reais, sem imposto nem frete.",
      "Formato / Exemplo": "45.90 (use ponto decimal)",
    },
    {
      Coluna: "margem_minima_pct",
      "Obrigatório?": "Não",
      Descrição:
        "Margem mínima aceitável, em %. O sistema NUNCA adere a uma campanha que resulte em margem abaixo disso, sem exceção. Se vazio, usa a margem mínima GERAL definida em Configurações.",
      "Formato / Exemplo": "12  (= 12%, não 0.12)",
    },
    {
      Coluna: "margem_alvo_pct",
      "Obrigatório?": "Não",
      Descrição:
        "Margem 'ideal', em %. Usada para CALCULAR o preço em campanhas onde você define o preço (DEAL, SELLER_CAMPAIGN, LIGHTNING, DOD). Se vazio, usa a margem alvo GERAL de Configurações; se essa também estiver vazia, usa a margem mínima (do item ou geral) como alvo.",
      "Formato / Exemplo": "20",
    },
    {
      Coluna: "participar_campanhas",
      "Obrigatório?": "Não",
      Descrição:
        "SIM ou NAO. Se NAO (ou se a coluna vier vazia é tratado como SIM), o item fica cadastrado mas é ignorado na hora de calcular decisões.",
      "Formato / Exemplo": "SIM",
    },
  ];
  const wsInstrucoes = XLSX.utils.json_to_sheet(instrucoes, {
    header: ["Coluna", "Obrigatório?", "Descrição", "Formato / Exemplo"],
  });
  wsInstrucoes["!cols"] = [{ wch: 22 }, { wch: 14 }, { wch: 70 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsInstrucoes, "Instruções");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="modelo_itens.xlsx"',
    },
  });
}
