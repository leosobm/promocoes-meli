import { NextResponse } from "next/server";
import { buildAuthorizationUrl } from "@/lib/mercadolivre/client";

/** Rota protegida pelo middleware (exige login) — inicia o fluxo OAuth. */
export async function GET() {
  return NextResponse.redirect(buildAuthorizationUrl());
}
