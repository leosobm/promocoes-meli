import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/mercadolivre/client";

/** Rota pública (middleware libera) — o Mercado Livre redireciona pra cá
 * depois do usuário autorizar o app, com ?code=... na URL. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const errorParam = request.nextUrl.searchParams.get("error");
  const base = request.nextUrl.origin;

  if (errorParam) {
    return NextResponse.redirect(`${base}/?ml_status=erro&detalhe=${encodeURIComponent(errorParam)}`);
  }
  if (!code) {
    return NextResponse.redirect(`${base}/?ml_status=erro&detalhe=sem_code`);
  }
  try {
    await exchangeCodeForTokens(code);
    return NextResponse.redirect(`${base}/?ml_status=conectado`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.redirect(`${base}/?ml_status=erro&detalhe=${encodeURIComponent(msg)}`);
  }
}
