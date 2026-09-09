"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function UploadItemsForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<{ linha: number; erro: string }[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage(null);
    setRowErrors([]);
    try {
      const form = new FormData();
      form.append("file", file);
      const resp = await fetch("/api/itens/upload", { method: "POST", body: form });
      const data = await resp.json();
      if (!resp.ok) {
        setMessage(data.error ?? "Falha no upload.");
        setRowErrors(data.errors ?? []);
      } else {
        setMessage(`${data.imported} item(ns) importado(s)/atualizado(s).`);
        setRowErrors(data.errors ?? []);
        if (inputRef.current) inputRef.current.value = "";
        router.refresh();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-neutral-200 bg-white p-5">
      <div className="flex items-center gap-3">
        <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="text-sm" required />
        <button
          type="submit"
          disabled={uploading}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {uploading ? "Enviando..." : "Enviar"}
        </button>
      </div>
      {message && <p className="mt-3 text-sm text-neutral-700">{message}</p>}
      {rowErrors.length > 0 && (
        <ul className="mt-2 max-h-40 overflow-auto text-xs text-red-600">
          {rowErrors.map((e, idx) => (
            <li key={idx}>
              Linha {e.linha}: {e.erro}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
