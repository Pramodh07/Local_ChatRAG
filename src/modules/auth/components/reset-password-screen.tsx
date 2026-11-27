"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, Eye, EyeOff, Logo, Lock, Moon, ShieldCheck, Sun } from "@/modules/shared/components/icons";
import { isStrongPassword } from "@/modules/auth/validation";
import { PasswordRequirements } from "@/modules/auth/components/password-requirements";
import { Button } from "@/modules/shared/components/ui/button";
import { Field, Input } from "@/modules/shared/components/ui/field";
import { Notice } from "@/modules/shared/components/ui/notice";
import { applyTheme, getDocumentTheme, type Theme } from "@/modules/shared/lib/theme";

type Status = "verifying" | "ready" | "invalid" | "done";

export function ResetPasswordScreen({ enabled }: { enabled: boolean }) {
  const attempted = useRef(false);
  const [status, setStatus] = useState<Status>(enabled ? "verifying" : "invalid");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>("light");

  const passwordIsValid = isStrongPassword(password);
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const canSubmit = passwordIsValid && passwordsMatch && !submitting;
  const passwordError =
    touched && !passwordIsValid ? "Complete every password requirement." : null;
  const confirmError =
    touched && !passwordsMatch
      ? confirmPassword
        ? "Passwords do not match."
        : "Confirm your new password."
      : null;

  useEffect(() => {
    const savedTheme = getDocumentTheme();
    if (savedTheme) setTheme(savedTheme);
  }, []);

  useEffect(() => {
    if (!enabled || attempted.current) return;
    attempted.current = true;

    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) {
      setStatus("invalid");
      return;
    }

    let cancelled = false;
    async function exchangeCode() {
      try {
        const { createSupabaseBrowserClient } = await import("@/modules/auth/supabase-browser");
        const { error } = await createSupabaseBrowserClient().auth.exchangeCodeForSession(code!);
        if (cancelled) return;
        setStatus(error ? "invalid" : "ready");
      } catch {
        if (!cancelled) setStatus("invalid");
      }
    }

    void exchangeCode();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    setErrorMessage(null);
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      const { createSupabaseBrowserClient } = await import("@/modules/auth/supabase-browser");
      const { error } = await createSupabaseBrowserClient().auth.updateUser({ password });
      if (error) throw error;
      setStatus("done");
    } catch {
      setErrorMessage("Your password could not be updated. Request a new recovery link and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }

  return (
    <main className="relative flex min-h-dvh flex-col text-ink">
      <header className="flex h-16 shrink-0 items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo className="h-8 w-8" />
          <span className="text-sm font-semibold tracking-[-0.02em]">Atlas</span>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          onClick={toggleTheme}
          className="rounded-full border border-line bg-[var(--surface-solid)] text-muted hover:text-ink"
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </Button>
      </header>

      <div className="flex flex-1 items-center justify-center px-5 pb-16">
        <section className="w-full max-w-[420px] animate-panel rounded-[var(--radius-container)] border border-line bg-surface-solid p-6">
          <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">
            <Lock size={18} />
          </div>

          {status === "verifying" && (
            <div role="status">
              <h1 className="text-[22px] font-semibold tracking-[-0.025em]">Verifying your link</h1>
              <p className="mt-1 text-[13px] leading-6 text-muted">
                Hold on while we confirm your recovery link.
              </p>
              <div className="mt-6 flex items-center gap-2 text-xs text-muted">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-r-transparent" />
                Checking link…
              </div>
            </div>
          )}

          {status === "invalid" && (
            <div>
              <h1 className="text-[22px] font-semibold tracking-[-0.025em]">Link expired</h1>
              <p className="mt-1 text-[13px] leading-6 text-muted">
                This recovery link is invalid or has already been used. Request a new one from the
                sign-in page.
              </p>
              <Button variant="primary" size="lg" fullWidth className="mt-6" onClick={() => { window.location.href = "/"; }}>
                Back to sign in <ArrowRight size={15} />
              </Button>
            </div>
          )}

          {status === "ready" && (
            <form onSubmit={handleSubmit} noValidate>
              <h1 className="text-[22px] font-semibold tracking-[-0.025em]">Choose a new password</h1>
              <p className="mt-1 text-[13px] leading-6 text-muted">
                Use a strong password you don&apos;t reuse anywhere else.
              </p>

              <div className="mt-5 space-y-4">
                <Field label="New password" htmlFor="reset-password" error={passwordError}>
                  <div className="relative">
                    <Input
                      id="reset-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      maxLength={20}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      onBlur={() => setTouched(true)}
                      invalid={Boolean(passwordError)}
                      className="pr-11"
                      aria-describedby="reset-requirements"
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-[10px] text-muted transition-colors hover:text-ink"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((visible) => !visible)}
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  <PasswordRequirements id="reset-requirements" password={password} size="compact" />
                </Field>

                <Field label="Confirm new password" htmlFor="reset-confirm" error={confirmError}>
                  <Input
                    id="reset-confirm"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    maxLength={20}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    onBlur={() => setTouched(true)}
                    invalid={Boolean(confirmError)}
                  />
                </Field>
              </div>

              {errorMessage && (
                <div className="mt-4">
                  <Notice tone="error">{errorMessage}</Notice>
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={submitting}
                disabled={!canSubmit}
                className="mt-5"
              >
                {submitting ? "Updating password…" : "Update password"}
                {!submitting && <ArrowRight size={15} />}
              </Button>
            </form>
          )}

          {status === "done" && (
            <div>
              <h1 className="text-[22px] font-semibold tracking-[-0.025em]">Password updated</h1>
              <p className="mt-1 text-[13px] leading-6 text-muted">
                You can now use your new password to sign in to Atlas.
              </p>
              <Button variant="primary" size="lg" fullWidth className="mt-6" onClick={() => { window.location.href = "/"; }}>
                Continue to Atlas <ArrowRight size={15} />
              </Button>
            </div>
          )}

          <p className="mt-5 flex items-center justify-center gap-1.5 border-t border-line pt-4 text-[11.5px] text-faint">
            <ShieldCheck size={13} />
            Recovery links expire after a short time.
          </p>
        </section>
      </div>
    </main>
  );
}
