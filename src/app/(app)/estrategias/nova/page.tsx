import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/roles";
import EstrategiaForm from "@/components/EstrategiaForm";

export default async function NovaEstrategiaPage() {
  const current = await getCurrentUser();
  if (current?.role !== "admin") redirect("/");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Nova estratégia</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Define um período e uma margem mínima/alvo/tolerância que prevalece sobre o item/curva
          enquanto durar.
        </p>
      </div>
      <EstrategiaForm />
    </div>
  );
}
