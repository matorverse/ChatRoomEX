"use client";

import { type FormEvent, useState } from "react";

type Mode = "login" | "register";

export function AuthPanel() {
  const [mode, setMode] = useState<Mode>("login");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const payload = {
      handle: String(formData.get("handle") ?? ""),
      password: String(formData.get("password") ?? ""),
      displayName: String(formData.get("displayName") ?? "")
    };

    const response = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(mode === "login" ? { handle: payload.handle, password: payload.password } : payload)
    });

    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Authentication failed");
      return;
    }

    window.location.reload();
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <section className="w-full max-w-sm rounded-2xl border border-border-soft bg-surface p-5 shadow-soft dark:border-border-soft-dark dark:bg-surface-dark">
        <div className="mb-5">
          <h1 className="text-xl font-semibold">ChatRoomEX</h1>
          <p className="mt-1 text-sm leading-6 text-muted dark:text-muted-dark">Sign in to enter your realtime rooms.</p>
        </div>
        <div className="mb-4 grid grid-cols-2 rounded-xl bg-panel p-1 dark:bg-panel-dark">
          <button
            type="button"
            className={`rounded-lg text-sm ${mode === "login" ? "bg-surface shadow-sm dark:bg-surface-dark" : ""}`}
            onClick={() => {
              setError(null);
              setMode("login");
            }}
          >
            Login
          </button>
          <button
            type="button"
            className={`rounded-lg text-sm ${mode === "register" ? "bg-surface shadow-sm dark:bg-surface-dark" : ""}`}
            onClick={() => {
              setError(null);
              setMode("register");
            }}
          >
            Register
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm font-medium">
            Handle
            <input
              name="handle"
              autoComplete="username"
              required
              minLength={3}
              maxLength={32}
              pattern="[a-zA-Z0-9_]+"
              className="mt-1 h-11 w-full rounded-xl border border-border-soft bg-transparent px-3 outline-none focus:border-blue-strong dark:border-border-soft-dark"
            />
          </label>
          {mode === "register" ? (
            <label className="block text-sm font-medium">
              Display name
              <input
                name="displayName"
                autoComplete="name"
                required
                maxLength={80}
                className="mt-1 h-11 w-full rounded-xl border border-border-soft bg-transparent px-3 outline-none focus:border-blue-strong dark:border-border-soft-dark"
              />
            </label>
          ) : null}
          <label className="block text-sm font-medium">
            Password
            <input
              name="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={mode === "register" ? 6 : 1}
              maxLength={128}
              className="mt-1 h-11 w-full rounded-xl border border-border-soft bg-transparent px-3 outline-none focus:border-blue-strong dark:border-border-soft-dark"
            />
          </label>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <button type="submit" className="h-11 w-full rounded-xl bg-blue-strong font-semibold text-white disabled:opacity-50" disabled={pending}>
            {pending ? "Working..." : mode === "login" ? "Login" : "Create account"}
          </button>
        </form>
      </section>
    </main>
  );
}
