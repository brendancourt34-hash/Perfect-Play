"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PPMark } from "@/components/pp-mark";

/**
 * The only public page under /admin. Posts to the existing /api/auth/login (same
 * users/sessions system as the mobile app) — that route now also sets an httpOnly
 * `session` cookie, which is what every other /admin page checks server-side
 * (requireAdminForPage, src/lib/auth/require.ts). A successful login here does not by
 * itself grant admin access — it only proves identity; the next page load enforces the
 * separate isAdmin check and will show "Forbidden" for a non-admin account.
 */
export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!body.ok) {
        setError(body.errors?.[0] ?? body.message ?? "Login failed.");
        setLoading(false);
        return;
      }
      router.replace("/admin");
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Try again.");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-4">
      <PPMark className="mb-4 h-8 w-8 rounded-md" />
      <h1 className="text-xl font-bold text-foreground">Perfect Play Admin</h1>
      <p className="mt-1 text-sm text-muted">Internal operator sign-in.</p>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-muted">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-foreground outline-none focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-muted">Password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-foreground outline-none focus:border-brand"
          />
        </label>

        {error && <p className="text-sm text-danger">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="mt-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
