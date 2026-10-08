"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";

interface CurvaRow {
  curva: string;
  margem_minima_pct: number | null;
  margem_alvo_pct: number | null;
  margem_tolerancia_pct: number | null;
}

function parseField(v: string): number | null {
  return v === "" ? null : Number(v);
}

export default function CurvaSettingsForm({ initial }: { initial: CurvaRow[] }) {
  const [rows, setRows] = useState<CurvaRow[]>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function setField(curva: string, field: keyof Omit<CurvaRow, "curva">, v: string) {
    setRows((prev) => prev.map((r) => (r.curva === curva ? { ...r, [field]: parseField(v) } : r)));
    setSaved(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const supabase = createBrowserSupabase();
    await supabase.from("curva_settings").upsert(rows, { onConflict: "curva" });
    setSaving(false);
    setSaved(true);
  }

  return (
    <form onSubmit={handleSave} className="space-y-4 rounded-lg border border-neutral-200 bg-white p-6">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="py-1 pr-2">Curva</th>
              <th className="py-1 pr-2">Margem mínima (%)</th>
              <th className="py-1 pr-2">Margem alvo (%)</th>
              <th className="py-1 pr-2">Tolerância (%)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.curva} className="border-t border-neutral-100">
                <td className="py-2 pr-2 font-medium text-neutral-900">{r.curva}</td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="99"
                    value={r.margem_minima_pct ?? ""}
                    onChange={(e) => setField(r.curva, "margem_minima_pct", e.target.value)}
                    placeholder="geral"
                    className="w-28 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="99"
                    value={r.margem_alvo_pct ?? ""}
                    onChange={(e) => setField(r.curva, "margem_alvo_pct", e.target.value)}
                    placeholder="geral"
                    className="w-28 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={r.margem_tolerancia_pct ?? ""}
                    onChange={(e) => setField(r.curva, "margem_tolerancia_pct", e.target.value)}
                    placeholder="geral"
                    className="w-28 rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-500">
        Campo em branco (&quot;geral&quot;) usa o valor geral do sistema pra essa curva.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {saving ? "Salvando..." : "Salvar"}
        </button>
        {saved && <span className="text-sm text-green-700">Salvo.</span>}
      </div>
    </form>
  );
}
