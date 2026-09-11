"use client";

import DecisionTable, { type DecisionRow } from "@/components/DecisionTable";

export default function PainelClient({
  rows,
  toleranciaRows,
}: {
  rows: DecisionRow[];
  toleranciaRows: DecisionRow[];
}) {
  if (rows.length === 0 && toleranciaRows.length === 0) {
    return (
      <p className="rounded-md border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
        Nenhuma decisão pendente. Rode &quot;Atualizar agora&quot; no Painel para calcular.
      </p>
    );
  }

  return (
    <div className="space-y-10">
      <DecisionTable
        rows={rows}
        title="Decisões calculadas"
        description="A melhor campanha por item, dentro do piso de margem — filtre, ordene e selecione em massa antes de aplicar."
      />
      {toleranciaRows.length > 0 && (
        <DecisionTable
          rows={toleranciaRows}
          variant="tolerancia"
          title="Oportunidades abaixo do piso (dentro da tolerância)"
          description="Itens sem nenhuma campanha dentro do piso de margem, mas que ficam dentro da tolerância configurada. Nunca são escolhidos nem aplicados automaticamente — exigem sua aprovação manual explícita aqui."
        />
      )}
    </div>
  );
}
