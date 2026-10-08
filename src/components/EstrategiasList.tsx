"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Estrategia {
  id: string;
  nome: string;
  data_inicio: string;
  data_fim: string;
  tipo_escopo: "item" | "curva";
  margem_minima_pct: number | null;
  margem_alvo_pct: number | null;
  margem_tolerancia_pct: number | null;
  total_alvos: number;
  status: "agendada" | "ativa" | "encerrada";
}

const STATUS_LABEL: Record<Estrategia["status"], string> = {
  agendada: "Agendada",
  ativa: "Ativa",
  encerrada: "Encerrada",
};
const STATUS_COLOR: Record<Estrategia["status"], string> = {
  agendada: "bg-blue-100 text-blue-800",
  ativa: "bg-green-100 text-green-800",
  encerrada: "bg-neutral-100 text-neutral-500",
};

function fmtPct(v: number | null) {
  return v == null ? "-" : `${v}%`;
}
function fmtData(v: string) {
  return new Date(`${v}T00:00:00`).toLocaleDateString("pt-BR");
}

export default function EstrategiasList({ estrategias }: { estrategias: Estrategia[] }) {
  const router = useRouter();
  const [excluindo, setExcluindo] = useState<string | null>(null);

  async function handleExcluir(id: string, nome: string) {
    if (!confirm(`Excluir a estratégia "${nome}"? Isso não pode ser desfeito.`)) return;
    setExcluindo(id);
    const resp = await fetch(`/api/estrategias/${id}`, { method: "DELETE" });
    setExcluindo(null);
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      alert(`Falha ao excluir: ${data.error ?? resp.statusText}`);
      return;
    }
    router.refresh();
  }

  if (estrategias.length === 0) {
    return (
      <p className="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
        Nenhuma estratégia cadastrada ainda.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
          <tr>
            <th className="p-3">Nome</th>
            <th className="p-3">Status</th>
            <th className="p-3">Período</th>
            <th className="p-3">Escopo</th>
            <th className="p-3 text-right">Mín. / Alvo / Toler.</th>
            <th className="p-3"></th>
          </tr>
        </thead>
        <tbody>
          {estrategias.map((e) => (
            <tr key={e.id} className="border-t border-neutral-100">
              <td className="p-3 font-medium text-neutral-900">{e.nome}</td>
              <td className="p-3">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[e.status]}`}>
                  {STATUS_LABEL[e.status]}
                </span>
              </td>
              <td className="p-3 text-xs text-neutral-600">
                {fmtData(e.data_inicio)} – {fmtData(e.data_fim)}
              </td>
              <td className="p-3 text-xs text-neutral-600">
                {e.tipo_escopo === "item" ? "Por item" : "Por curva"} ({e.total_alvos})
              </td>
              <td className="p-3 text-right text-xs text-neutral-600">
                {fmtPct(e.margem_minima_pct)} / {fmtPct(e.margem_alvo_pct)} / {fmtPct(e.margem_tolerancia_pct)}
              </td>
              <td className="p-3 text-right">
                <div className="flex justify-end gap-3">
                  <Link href={`/estrategias/${e.id}`} className="text-xs font-medium text-neutral-600 hover:underline">
                    Editar
                  </Link>
                  <button
                    onClick={() => handleExcluir(e.id, e.nome)}
                    disabled={excluindo === e.id}
                    className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                  >
                    {excluindo === e.id ? "Excluindo..." : "Excluir"}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
