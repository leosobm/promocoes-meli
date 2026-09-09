import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import NavShell from "@/components/NavShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <NavShell userEmail={user.email ?? ""}>{children}</NavShell>;
}
