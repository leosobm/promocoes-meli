"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const CURVAS = ["A", "B", "C", "D", "Lançamento"] as const;

interface ItemSelecionado {
  mlb: string;
  title: string | null;
}

export interface EstrategiaInitial {
  id: string;
  nome: string;
  data_inicio: string;
  data_fim: string;
  tipo_escopo: "item" | "curva";
  margem_minima_pct: number | null;
  margem_alvo_pct: number | null;
  margem_tolerancia_pct: number | null;
  mlbs: string[];
  curvas: string[];
}

export default function EstrategiaForm({ initial }: { initial?: EstrategiaInitial }) {
  const router = useRouter();
  const editando = !!initial;

  const [nome, setNome] = useState(initial?.nome ?? "");
  const [dataInicio, setDataInicio] = useState(initial?.data_inicio ?? "");
  const [dataFim, setDataFim] = useState(initial?.data_fim ?? "");
  const [tipoEscopo, setTipoEscopo] = useState<"item" | "curva">(initial?.tipo_escopo ?? "item");
  const [margemMinima, setMargemMinima] = useState(initial?.margem_minima_pct?.toString() ?? "");
  const [margemAlvo, setMargemAlvo] = useState(initial?.margem_alvo_pct?.toString() ?? "");
  const [margemTolerancia, setMargemTolerancia] = useState(initial?.margem_tolerancia_pct?.toString() ?? "");
  const [curvasSelecionadas, setCurvasSelecionadas] = useState<Set<string>>(new Set(initial?.curvas ?? []));
  const [itensSelecionados, setItensSelecionados] = useState<ItemSelecionado[]>(
    (initial?.mlbs ?? []).map((mlb) => ({ mlb, title: null })),
  );

  const [busca, setBusca] = useState("");
  const [resultadosBusca, setResultadosBusca] = useState<ItemSelecionado[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [uploadErro, setUploadErro] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleBuscaChange(valor: string) {
    setBusca(valor);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (valor.trim().length < 2) {
      setResultadosBusca([]);
      return;
    }
    setBuscando(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const resp = await fetch(`/api/itens/buscar?q=${encodeURIComponent(valor.trim())}`);
        const data = await resp.json();
        setResultadosBusca(data.itens ?? []);
      } finally {
        setBuscando(false);
      }
    }, 300);
  }

  function adicionarItem(item: ItemSelecionado) {
    setItensSelecionados((prev) => (prev.some((i) => i.mlb === item.mlb) ? prev : [...prev, item]));
  }
  function removerItem(mlb: string) {
    setItensSelecionados((prev) => prev.filter((i) => i.mlb !== mlb));
  }
  function toggleCurva(curva: string) {
    setCurvasSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(curva)) next.delete(curva);
      else next.add(curva);
      return next;
    });
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadErro(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const resp = await fetch("/api/estrategias/parse-mlbs", { method: "POST", body: form });
      const data = await resp.json();
      if (!resp.ok) {
        setUploadErro(data.error ?? "Falha ao ler a planilha.");
        return;
      }
      setItensSelecionados((prev) => {
        const existentes = new Set(prev.map((i) => i.mlb));
        const novos: ItemSelecionado[] = (data.mlbs as string[])
          .filter((mlb) => !existentes.has(mlb))
          .map((mlb) => ({ mlb, title: null }));
        return [...prev, ...novos];
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const body = {
        nome,
        data_inicio: dataInicio,
        data_fim: dataFim,
        tipo_escopo: tipoEscopo,
        margem_minima_pct: margemMinima === "" ? null : Number(margemMinima),
        margem_alvo_pct: margemAlvo === "" ? null : Number(margemAlvo),
        margem_tolerancia_pct: margemTolerancia === "" ? null : Number(margemTolerancia),
        mlbs: tipoEscopo === "item" ? itensSelecionados.map((i) => i.mlb) : [],
        curvas: tipoEscopo === "curva" ? [...curvasSelecionadas] : [],
      };
      const resp = await fetch(editando ? `/api/estrategias/${initial!.id}` : "/api/estrategias", {
        method: editando ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setErro(data.error ?? "Falha ao salvar.");
        return;
      }
      router.push("/estrategias");
      router.refresh();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-6">
        <div className="space-y-1">
          <label className="block text-sm font-medium text-neutral-700">Nome</label>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            placeholder="Ex.: Black Friday 2026"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-neutral-700">Data de início</label>
            <input
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
              required
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-neutral-700">Data de fim</label>
            <input
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
              required
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="block text-xs text-neutral-500">Margem mínima (%)</label>
            <input
              type="number" step="0.1" min="0" max="99"
              value={margemMinima}
              onChange={(e) => setMargemMinima(e.target.value)}
              placeholder="não altera"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-neutral-500">Margem alvo (%)</label>
            <input
              type="number" step="0.1" min="0" max="99"
              value={margemAlvo}
              onChange={(e) => setMargemAlvo(e.target.value)}
              placeholder="não altera"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-xs text-neutral-500">Tolerância (%)</label>
            <input
              type="number" step="0.1" min="0" max="100"
              value={margemTolerancia}
              onChange={(e) => setMargemTolerancia(e.target.value)}
              placeholder="não altera"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <p className="text-xs text-neutral-500">
          Campo em branco não sobrescreve esse nível — continua usando a margem do item/curva ou a
          geral do sistema normalmente, mesmo com a estratégia ativa.
        </p>
      </div>

      <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-6">
        <div className="space-y-1">
          <label className="block text-sm font-medium text-neutral-700">Escopo</label>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={tipoEscopo === "item"}
                onChange={() => setTipoEscopo("item")}
                disabled={editando}
              />
              Por item
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={tipoEscopo === "curva"}
                onChange={() => setTipoEscopo("curva")}
                disabled={editando}
              />
              Por curva
            </label>
          </div>
          {editando && (
            <p className="text-xs text-neutral-400">Escopo não pode ser trocado numa estratégia existente.</p>
          )}
        </div>

        {tipoEscopo === "curva" ? (
          <div className="flex flex-wrap gap-3">
            {CURVAS.map((curva) => (
              <label
                key={curva}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm ${
                  curvasSelecionadas.has(curva) ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"
                }`}
              >
                <input
                  type="checkbox"
                  checked={curvasSelecionadas.has(curva)}
                  onChange={() => toggleCurva(curva)}
                  className="sr-only"
                />
                {curva}
              </label>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <input
                value={busca}
                onChange={(e) => handleBuscaChange(e.target.value)}
                placeholder="Buscar por MLB ou título..."
                className="w-64 rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
              <label className="cursor-pointer rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
                {uploading ? "Lendo..." : "Enviar planilha (.csv/.xlsx)"}
                <input type="file" accept=".csv,.xlsx,.xls" onChange={handleUpload} disabled={uploading} className="hidden" />
              </label>
            </div>
            {uploadErro && <p className="text-xs text-red-600">{uploadErro}</p>}

            {busca.trim().length >= 2 && (
              <div className="max-h-48 overflow-auto rounded-md border border-neutral-200">
                {buscando ? (
                  <p className="p-3 text-xs text-neutral-400">Buscando...</p>
                ) : resultadosBusca.length === 0 ? (
                  <p className="p-3 text-xs text-neutral-400">Nenhum item encontrado.</p>
                ) : (
                  resultadosBusca.map((item) => (
                    <button
                      type="button"
                      key={item.mlb}
                      onClick={() => adicionarItem(item)}
                      className="flex w-full items-center justify-between border-t border-neutral-100 px-3 py-2 text-left text-sm first:border-t-0 hover:bg-neutral-50"
                    >
                      <span>
                        <span className="font-medium">{item.mlb}</span>
                        {item.title && <span className="ml-2 text-neutral-500">{item.title}</span>}
                      </span>
                      <span className="text-xs text-blue-600">+ adicionar</span>
                    </button>
                  ))
                )}
              </div>
            )}

            <div>
              <p className="mb-1 text-xs font-medium text-neutral-500">
                {itensSelecionados.length} item(ns) selecionado(s)
              </p>
              {itensSelecionados.length > 0 && (
                <div className="max-h-56 overflow-auto rounded-md border border-neutral-200">
                  {itensSelecionados.map((item) => (
                    <div
                      key={item.mlb}
                      className="flex items-center justify-between border-t border-neutral-100 px-3 py-1.5 text-sm first:border-t-0"
                    >
                      <span>
                        <span className="font-medium">{item.mlb}</span>
                        {item.title && <span className="ml-2 text-neutral-500">{item.title}</span>}
                      </span>
                      <button
                        type="button"
                        onClick={() => removerItem(item.mlb)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        remover
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {erro && <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">{erro}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={salvando}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {salvando ? "Salvando..." : editando ? "Salvar alterações" : "Criar estratégia"}
        </button>
      </div>
    </form>
  );
}
