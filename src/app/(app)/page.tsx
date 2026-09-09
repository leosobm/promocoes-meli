import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { hasAutoRefresh, isConnected } from "@/lib/mercadolivre/tokens";
import UpdateButton from "@/components/UpdateButton";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ ml_status?: string; detalhe?: string }>;
}) {
  const { ml_status, detalhe } = await searchParams;
  const connected = await isConnected();
  const autoRefresh = connected ? await hasAutoRefresh() : true;

  const supabase = await createServerSupabase();
  const { count: pendentes } = await supabase
    .from("campaign_decisions")
    .select("*", { count: "exact", head: true })
    .eq("status", "pendente")
    .eq("escolhida", true);
  const { data: lastDecision } = await supabase
    .from("campaign_decisions")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Painel</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Leia as campanhas, calcule as decisões e revise antes de aplicar qualquer coisa.
        </p>
      </div>

      {ml_status === "conectado" && (
        <div className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-800">
          Conta do Mercado Livre conectada com sucesso.
        </div>
      )}
      {ml_status === "erro" && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
          Falha ao conectar: {detalhe}
        </div>
      )}

      {!connected ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">
            A conta do Mercado Livre ainda não está conectada — conecte antes de atualizar.
          </p>
          <a
            href="/api/mercadolivre/connect"
            className="mt-3 inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Conectar Mercado Livre
          </a>
        </div>
      ) : (
        <div className="rounded-lg border border-neutral-200 bg-white p-5">
          {!autoRefresh && (
            <div className="mb-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Esta conexão não tem <b>refresh_token</b> — o Mercado Livre não emitiu um (confira se
              a opção &quot;Refresh Token&quot; está habilitada nas credenciais do seu app, no
              painel de desenvolvedores). Sem isso, o acesso expira em algumas horas e você vai
              precisar clicar em &quot;Conectar Mercado Livre&quot; de novo quando parar de
              funcionar.
              <a href="/api/mercadolivre/connect" className="ml-2 font-medium underline">
                Reconectar agora
              </a>
            </div>
          )}
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-neutral-500">
                {lastDecision
                  ? `Última atualização: ${new Date(lastDecision.created_at).toLocaleString("pt-BR")}`
                  : "Ainda não rodou nenhuma atualização."}
              </p>
              <p className="text-sm text-neutral-500">
                <b>{pendentes ?? 0}</b> decisões pendentes (melhor campanha por item, aguardando revisão).
              </p>
            </div>
            <Link
              href="/painel"
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Ver painel de decisões
            </Link>
          </div>
          <UpdateButton />
        </div>
      )}
    </div>
  );
}
