"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Status = "idle" | "rodando" | "concluido" | "erro";

const STATUS_CHIP: Record<Status, { text: string; className: string; dot: string }> = {
  idle: { text: "Nenhuma atualização em andamento", className: "bg-neutral-100 text-neutral-600", dot: "bg-neutral-400" },
  rodando: { text: "Atualização em andamento...", className: "bg-blue-50 text-blue-700", dot: "bg-blue-500 animate-pulse" },
  concluido: { text: "Atualização concluída", className: "bg-green-50 text-green-700", dot: "bg-green-500" },
  erro: { text: "Atualização com erro", className: "bg-red-50 text-red-700", dot: "bg-red-500" },
};

export default function UpdateButton() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);

  async function handleClick() {
    setStatus("rodando");
    setLogs([]);
    setProgress(null);
    setSummary(null);
    try {
      const resp = await fetch("/api/atualizar", { method: "POST" });
      if (!resp.body) throw new Error("Resposta sem corpo (stream).");
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let hadError = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.replace(/^data: /, "").trim();
          if (!line) continue;
          const evt = JSON.parse(line);
          if (evt.type === "log") setLogs((l) => [...l, evt.message]);
          if (evt.type === "progress") setProgress({ done: evt.done, total: evt.total });
          if (evt.type === "error") {
            hadError = true;
            setLogs((l) => [...l, `ERRO: ${evt.message}`]);
            setSummary(evt.message);
          }
          if (evt.type === "done") {
            setSummary(
              `${evt.totalDecisions} decisões calculadas — ${evt.totalEscolhidas} campanha(s) escolhida(s) pra revisar.`,
            );
          }
        }
      }
      setStatus(hadError ? "erro" : "concluido");
      router.refresh();
    } catch (e) {
      setLogs((l) => [...l, `ERRO: ${e instanceof Error ? e.message : String(e)}`]);
      setStatus("erro");
    }
  }

  const chip = STATUS_CHIP[status];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleClick}
          disabled={status === "rodando"}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {status === "rodando" ? "Atualizando..." : "Atualizar agora"}
        </button>
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${chip.className}`}>
          <span className={`h-2 w-2 rounded-full ${chip.dot}`} />
          {chip.text}
        </span>
      </div>

      {status === "rodando" && progress && (
        <div className="space-y-1">
          <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-neutral-200">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
            />
          </div>
          <p className="text-xs text-neutral-500">
            {progress.done} de {progress.total} MLBs processados
          </p>
        </div>
      )}

      {summary && (
        <p className={`text-sm ${status === "erro" ? "text-red-700" : "text-neutral-700"}`}>{summary}</p>
      )}

      {logs.length > 0 && (
        <div>
          <button
            onClick={() => setShowLogs((v) => !v)}
            className="text-xs font-medium text-neutral-500 hover:underline"
          >
            {showLogs ? "Ocultar logs" : `Ver logs (${logs.length})`}
          </button>
          {showLogs && (
            <pre className="mt-2 max-h-64 max-w-xl overflow-auto rounded-md bg-neutral-900 p-3 text-xs text-neutral-100">
              {logs.join("\n")}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
