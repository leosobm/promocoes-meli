/**
 * Fórmulas de precificação/margem — reproduzem EXATAMENTE a planilha
 * Calc_Meli.xlsx do usuário (confirmado em 2026-09-09, não inventar
 * fórmula alternativa). Todos os "_pct" aqui são frações (0.20 = 20%),
 * não números inteiros — a conversão de/para "20" acontece na borda
 * (UI / leitura do banco), nunca dentro destas funções.
 */

export interface PricingInputs {
  cmv: number;
  freteMedio: number;
  taxasPct: number; // fração
  comissaoPct: number; // fração (percentage_fee do listing_prices)
  descontoTarifaValor: number; // R$ por unidade (redução de tarifa do ML), ou 0
}

/** Calculadora de Preço: dado uma margem-alvo, calcula o preço de venda.
 * Inversa exata de calcMargemResultante, com a redução de tarifa em R$:
 * PREÇO = (CMV + Frete − Redução_R$) / (1 − (Taxas + Comissão + Margem_alvo)).
 * A redução é um valor fixo por unidade; o % que a API devolve é sobre o
 * preço DE, então subtraí-lo como se fosse % do preço final (como era
 * antes) superestimava o preço necessário. */
export function calcPrecoParaMargem(inputs: PricingInputs & { margemAlvoPct: number }): number {
  const { cmv, freteMedio, taxasPct, comissaoPct, margemAlvoPct, descontoTarifaValor } = inputs;
  const denominador = 1 - (taxasPct + comissaoPct + margemAlvoPct);
  if (denominador <= 0) {
    throw new Error(
      "Denominador <= 0 na fórmula de preço (taxas+comissão+margem alvo muito altos) — não é possível calcular um preço válido.",
    );
  }
  return (cmv + freteMedio - descontoTarifaValor) / denominador;
}

/** Calculadora de Margem: dado um preço real, calcula a margem resultante.
 * Comissão_efetiva_R$ = (PREÇO * Comissão) - Desconto_tarifa_R$
 * MARGEM = (PREÇO - CMV - Frete_Médio - Comissão_efetiva_R$ - (PREÇO * Taxas)) / PREÇO */
export function calcMargemResultante(inputs: {
  preco: number;
  cmv: number;
  freteMedio: number;
  comissaoPct: number; // fração
  taxasPct: number; // fração
  descontoTarifaValor: number | null; // R$ exato (discount_meli_boost_amount), 0 se não aplicável
}): number {
  const { preco, cmv, freteMedio, comissaoPct, taxasPct, descontoTarifaValor } = inputs;
  if (preco <= 0) return -Infinity;
  const comissaoEfetiva = preco * comissaoPct - (descontoTarifaValor ?? 0);
  const lucro = preco - cmv - freteMedio - comissaoEfetiva - preco * taxasPct;
  return lucro / preco;
}

/** Maior preço <= `preco` terminado em ,90 ou ,49 (regra de precificação
 * do usuário: sempre arredonda PARA BAIXO, mesmo que a margem fique abaixo
 * da meta por causa disso). Em centavos inteiros pra não errar por ponto
 * flutuante (34.34 * 100 = 3433.9999...). null se não sobrar preço > 0. */
export function arredondarPrecoPsicologico(preco: number): number | null {
  const centavos = Math.floor(preco * 100 + 1e-6);
  const reais = Math.floor(centavos / 100);
  for (const candidato of [reais * 100 + 90, reais * 100 + 49, (reais - 1) * 100 + 90]) {
    if (candidato > 0 && candidato <= centavos) return candidato / 100;
  }
  return null;
}

export function calcDescontoConsumidorPct(precoOriginal: number, precoFinal: number): number {
  if (!precoOriginal || precoOriginal <= 0) return 0;
  return (precoOriginal - precoFinal) / precoOriginal;
}

export interface ScoreWeights {
  pesoDesconto: number; // fração (ex.: 0.40)
  pesoMl: number; // fração (ex.: 0.35)
  pesoMargem: number; // fração (ex.: 0.25)
}

export interface ScoreFactors {
  descontoConsumidorPct: number; // fração
  mlParticipacaoPct: number | null; // fração, ou null se não existir para esta oferta
  margemPct: number; // fração
}

export interface ScoreResult {
  score: number; // 0-100 (mesma escala dos fatores, em %)
  fatoresUsados: ("desconto" | "ml" | "margem")[];
}

/**
 * Pontuação ponderada com redistribuição PROPORCIONAL do peso quando o
 * fator "participação do ML" não existe para a oferta — confirmado com o
 * usuário em 2026-09-09: score = Σ(peso_i * valor_i) / Σ(peso_i), só com
 * os fatores disponíveis. Mantém a escala 0-100 e não penaliza a oferta
 * por falta de dado (não trata ausência como zero).
 */
export function calcScore(factors: ScoreFactors, weights: ScoreWeights): ScoreResult {
  const entries: { key: "desconto" | "ml" | "margem"; peso: number; valor: number }[] = [
    { key: "desconto", peso: weights.pesoDesconto, valor: factors.descontoConsumidorPct * 100 },
    { key: "margem", peso: weights.pesoMargem, valor: factors.margemPct * 100 },
  ];
  if (factors.mlParticipacaoPct !== null) {
    entries.push({ key: "ml", peso: weights.pesoMl, valor: factors.mlParticipacaoPct * 100 });
  }
  const pesoTotal = entries.reduce((s, e) => s + e.peso, 0);
  if (pesoTotal <= 0) return { score: 0, fatoresUsados: entries.map((e) => e.key) };
  const score = entries.reduce((s, e) => s + e.peso * e.valor, 0) / pesoTotal;
  return { score, fatoresUsados: entries.map((e) => e.key) };
}
