"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function UpdateButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function handleClick() {
    setRunning(true);
    setLogs([]);
    setProgress(null);
    try {
      const resp = await fetch("/api/atualizar", { method: "POST" });
      if (!resp.body) throw new Error("Resposta sem corpo (stream).");
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
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
          if (evt.type === "error") setLogs((l) => [...l, `ERRO: ${evt.message}`]);
          if (evt.type === "done") {
            setLogs((l) => [
              ...l,
              `Concluído: ${evt.totalDecisions} decisões calculadas, ${evt.totalEscolhidas} campanhas escolhidas.`,
            ]);
          }
        }
      }
      router.refresh();
    } catch (e) {
      setLogs((l) => [...l, `ERRO: ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={handleClick}
        disabled={running}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {running ? "Atualizando..." : "Atualizar agora"}
      </button>
      {progress && (
        <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-neutral-200">
          <div
            className="h-full bg-neutral-900 transition-all"
            style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
          />
        </div>
      )}
      {logs.length > 0 && (
        <pre className="max-h-64 max-w-xl overflow-auto rounded-md bg-neutral-900 p-3 text-xs text-neutral-100">
          {logs.join("\n")}
        </pre>
      )}
    </div>
  );
}
