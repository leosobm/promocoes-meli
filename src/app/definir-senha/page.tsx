"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";

type Fase = "verificando" | "pronto" | "salvando" | "sucesso" | "erro";

function DefinirSenhaForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [fase, setFase] = useState<Fase>("verificando");
  const [erro, setErro] = useState<string | null>(null);
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");

  useEffect(() => {
    const supabase = createBrowserSupabase();
    const tokenHash = searchParams.get("token_hash");
    // "invite" (convite novo) ou "recovery" (reset de senha) — o Supabase
    // usa o mesmo mecanismo de link pros dois casos, o resultado aqui é o
    // mesmo: estabelece sessão e deixa o usuário escolher uma senha.
    const type = (searchParams.get("type") as "invite" | "recovery" | null) ?? "invite";

    if (!tokenHash) {
      setFase("erro");
      setErro("Link inválido ou incompleto — faltam parâmetros. Peça um novo convite/reset.");
      return;
    }

    supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ error }) => {
      if (error) {
        setFase("erro");
        setErro(
          error.message.includes("expired")
            ? "Este link expirou. Peça pra um admin enviar um novo convite ou reset de senha."
            : `Não foi possível validar o link: ${error.message}`,
        );
        return;
      }
      setFase("pronto");
    });
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (senha.length < 6) {
      setErro("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }
    if (senha !== confirmacao) {
      setErro("As senhas não coincidem.");
      return;
    }
    setErro(null);
    setFase("salvando");
    const supabase = createBrowserSupabase();
    const { error } = await supabase.auth.updateUser({ password: senha });
    if (error) {
      setFase("pronto");
      setErro(error.message);
      return;
    }
    setFase("sucesso");
    setTimeout(() => {
      router.push("/");
      router.refresh();
    }, 1500);
  }

  return (
    <div className="w-full max-w-sm space-y-4 rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
      <h1 className="text-lg font-semibold text-neutral-900">Definir senha</h1>

      {fase === "verificando" && <p className="text-sm text-neutral-500">Validando link...</p>}

      {fase === "erro" && <p className="text-sm text-red-600">{erro}</p>}

      {(fase === "pronto" || fase === "salvando") && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-neutral-700">Nova senha</label>
            <input
              type="password"
              required
              minLength={6}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-neutral-700">Confirmar senha</label>
            <input
              type="password"
              required
              minLength={6}
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
            />
          </div>
          {erro && <p className="text-sm text-red-600">{erro}</p>}
          <button
            type="submit"
            disabled={fase === "salvando"}
            className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {fase === "salvando" ? "Salvando..." : "Salvar senha e entrar"}
          </button>
        </form>
      )}

      {fase === "sucesso" && <p className="text-sm text-green-700">Senha definida! Entrando...</p>}
    </div>
  );
}

export default function DefinirSenhaPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <Suspense fallback={null}>
        <DefinirSenhaForm />
      </Suspense>
    </div>
  );
}
