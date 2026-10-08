import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/requireAdmin";

/** Busca itens por MLB (item_config, fonte canônica) ou por título
 * (items_cache, só populado depois de ao menos uma "Atualizar agora") —
 * usada no "pesquisar e selecionar" do formulário de estratégia por item. */
export async function GET(request: NextRequest) {
  const { user, response } = await requireAdmin();
  if (!user) return response;

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ itens: [] });

  const supabase = createServiceSupabase();
  const [{ data: porMlb }, { data: porTitulo }] = await Promise.all([
    supabase.from("item_config").select("mlb").ilike("mlb", `%${q}%`).limit(20),
    supabase.from("items_cache").select("mlb").ilike("title", `%${q}%`).limit(20),
  ]);
  const mlbs = [...new Set([...(porMlb ?? []).map((i) => i.mlb), ...(porTitulo ?? []).map((i) => i.mlb)])].slice(0, 20);
  if (mlbs.length === 0) return NextResponse.json({ itens: [] });

  const { data: titulos } = await supabase.from("items_cache").select("mlb, title").in("mlb", mlbs);
  const tituloPorMlb = new Map((titulos ?? []).map((t) => [t.mlb, t.title]));

  return NextResponse.json({
    itens: mlbs.map((mlb) => ({ mlb, title: tituloPorMlb.get(mlb) ?? null })),
  });
}
