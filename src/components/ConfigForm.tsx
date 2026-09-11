"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";

interface Settings {
  taxas_pct: number;
  peso_desconto_pct: number;
  peso_ml_pct: number;
  peso_margem_pct: number;
  margem_tolerancia_pct: number;
}

export default function ConfigForm({ initial }: { initial: Settings }) {
  const [values, setValues] = useState<Settings>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const pesoTotal = values.peso_desconto_pct + values.peso_ml_pct + values.peso_margem_pct;

  function setField(field: keyof Settings, v: string) {
    setValues((prev) => ({ ...prev, [field]: Number(v) }));
    setSaved(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const supabase = createBrowserSupabase();
    await supabase.from("app_settings").update(values).eq("id", 1);
    setSaving(false);
    setSaved(true);
  }

  return (
    <form onSubmit={handleSave} className="space-y-6 rounded-lg border border-neutral-200 bg-white p-6">
      <div className="space-y-1">
        <label className="block text-sm font-medium text-neutral-700">
          Taxas fixas (%) — imposto/antecipação de recebíveis etc.
        </label>
        <input
          type="number"
          step="0.01"
          value={values.taxas_pct}
          onChange={(e) => setField("taxas_pct", e.target.value)}
          className="w-40 rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-neutral-700">
          Pesos da pontuação de &quot;melhor campanha&quot; (devem somar 100)
        </h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="block text-xs text-neutral-500">Desconto ao consumidor</label>
            <input
              type="number"
              value={values.peso_desconto_pct}
              onChange={(e) => setField("peso_desconto_pct", e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-neutral-500">Participação do ML</label>
            <input
              type="number"
              value={values.peso_ml_pct}
              onChange={(e) => setField("peso_ml_pct", e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-neutral-500">Margem para mim</label>
            <input
              type="number"
              value={values.peso_margem_pct}
              onChange={(e) => setField("peso_margem_pct", e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        {pesoTotal !== 100 && (
          <p className="mt-2 text-xs text-amber-600">
            Soma atual: {pesoTotal}. O ideal é somar 100 (não é bloqueado, mas os pesos deixam de
            ser diretamente comparáveis a um percentual).
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label className="block text-sm font-medium text-neutral-700">
          Tolerância abaixo do piso de margem (%)
        </label>
        <input
          type="number"
          step="0.1"
          min="0"
          max="100"
          value={values.margem_tolerancia_pct}
          onChange={(e) => setField("margem_tolerancia_pct", e.target.value)}
          className="w-40 rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        <p className="text-xs text-neutral-500">
          Ex.: piso de 12% + tolerância de 10% = itens com margem a partir de 10,8% aparecem como
          &quot;oportunidade abaixo do piso&quot; no painel, pra você aprovar manualmente — nunca
          são escolhidos nem aplicados automaticamente. 0 = desliga a tolerância (comportamento
          estrito de sempre).
        </p>
      </div>

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
