import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/roles";
import NavShell from "@/components/NavShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const current = await getCurrentUser();
  if (!current) redirect("/login");

  return (
    <NavShell userEmail={current.email} isAdmin={current.role === "admin"}>
      {children}
    </NavShell>
  );
}
