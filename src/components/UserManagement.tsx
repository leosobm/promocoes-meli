"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface AppUserRow {
  id: string;
  email: string;
  role: "admin" | "usuario";
  created_at: string;
}

export default function UserManagement({
  users,
  currentUserId,
}: {
  users: AppUserRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "usuario">("usuario");
  const [inviting, setInviting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function call(url: string, body: object): Promise<{ ok: boolean; error?: string }> {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok) return { ok: false, error: data.error ?? "Falha na requisição." };
    return { ok: true };
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setMsg(null);
    const r = await call("/api/admin/users/invite", { email: inviteEmail.trim(), role: inviteRole });
    setInviting(false);
    if (!r.ok) {
      setMsg(`Erro: ${r.error}`);
      return;
    }
    setMsg(`Convite enviado para ${inviteEmail}.`);
    setInviteEmail("");
    router.refresh();
  }

  async function handleResetPassword(email: string) {
    setBusyId(email);
    const r = await call("/api/admin/users/reset-password", { email });
    setBusyId(null);
    setMsg(r.ok ? `E-mail de reset enviado para ${email}.` : `Erro: ${r.error}`);
  }

  async function handleRoleChange(userId: string, role: "admin" | "usuario") {
    setBusyId(userId);
    const r = await call("/api/admin/users/role", { userId, role });
    setBusyId(null);
    if (!r.ok) setMsg(`Erro: ${r.error}`);
    router.refresh();
  }

  async function handleDelete(userId: string, email: string) {
    if (!confirm(`Excluir o usuário ${email}? Essa ação não pode ser desfeita.`)) return;
    setBusyId(userId);
    const r = await call("/api/admin/users/delete", { userId });
    setBusyId(null);
    setMsg(r.ok ? `Usuário ${email} excluído.` : `Erro: ${r.error}`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div className="space-y-1">
          <label className="block text-xs text-neutral-500">E-mail do convidado</label>
          <input
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="w-64 rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs text-neutral-500">Papel</label>
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as "admin" | "usuario")}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
          >
            <option value="usuario">Usuário</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={inviting}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {inviting ? "Enviando..." : "Convidar"}
        </button>
      </form>

      {msg && <p className="text-sm text-neutral-600">{msg}</p>}

      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="p-3">E-mail</th>
              <th className="p-3">Papel</th>
              <th className="p-3">Desde</th>
              <th className="p-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-neutral-100">
                <td className="p-3 font-medium">
                  {u.email} {u.id === currentUserId && <span className="text-xs text-neutral-400">(você)</span>}
                </td>
                <td className="p-3">
                  <select
                    value={u.role}
                    disabled={busyId === u.id}
                    onChange={(e) => handleRoleChange(u.id, e.target.value as "admin" | "usuario")}
                    className="rounded-md border border-neutral-300 px-2 py-1 text-sm"
                  >
                    <option value="usuario">Usuário</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td className="p-3 text-xs text-neutral-500">{new Date(u.created_at).toLocaleDateString("pt-BR")}</td>
                <td className="p-3 space-x-3">
                  <button
                    disabled={busyId === u.id}
                    onClick={() => handleResetPassword(u.email)}
                    className="text-xs font-medium text-neutral-700 hover:underline disabled:opacity-50"
                  >
                    Reset de senha
                  </button>
                  <button
                    disabled={busyId === u.id || u.id === currentUserId}
                    onClick={() => handleDelete(u.id, u.email)}
                    className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                  >
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-neutral-500">
                  Nenhum usuário encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
