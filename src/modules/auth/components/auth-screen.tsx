"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Logo,
  Moon,
  ShieldCheck,
  Sun,
} from "@/modules/shared/components/icons";
import type { AuthProvider } from "@/modules/auth/types";
import { isStrongPassword, isValidEmail } from "@/modules/auth/validation";
import { PasswordRequirements } from "@/modules/auth/components/password-requirements";
import { Button } from "@/modules/shared/components/ui/button";
import { Field, Input } from "@/modules/shared/components/ui/field";
import { Notice } from "@/modules/shared/components/ui/notice";
import { Segmented } from "@/modules/shared/components/ui/segmented";
import { applyTheme, getDocumentTheme, type Theme } from "@/modules/shared/lib/theme";

type AuthMode = "sign-in" | "sign-up";

const modeOptions = [
  { value: "sign-in", label: "Sign in" },
  { value: "sign-up", label: "Create account" },
] as const;

export function AuthScreen({ authProvider }: { authProvider: AuthProvider }) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showResetHelp, setShowResetHelp] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);

  const emailIsValid = isValidEmail(email);
  const passwordIsValid = isStrongPassword(password);
  const nameIsValid = displayName.trim().length > 0 && displayName.trim().length <= 100;
  const canSubmit =
    emailIsValid &&
    (mode === "sign-in" ? password.length > 0 : passwordIsValid && nameIsValid) &&
    !isSubmitting;
  const emailError = emailTouched
    ? !email.trim()
      ? "Email is required."
      : !emailIsValid
        ? "Enter a valid email address, such as name@mail.com."
        : null
    : null;
  const passwordError = passwordTouched
    ? mode === "sign-up" && !passwordIsValid
      ? "Complete every password requirement."
      : mode === "sign-in" && !password
        ? "Password is required."
        : null
    : null;
  const nameError = nameTouched && !nameIsValid ? "Name is required." : null;

  useEffect(() => {
    const savedTheme = getDocumentTheme();
    if (savedTheme) setTheme(savedTheme);
    if (new URLSearchParams(window.location.search).get("auth") === "confirmation-error") {
      setErrorMessage("Email confirmation failed or expired. Request a new sign-up email and try again.");
    }
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setErrorMessage(null);
    setShowResetHelp(false);
    setEmailTouched(true);
    setPasswordTouched(true);
    if (mode === "sign-up") setNameTouched(true);
    if (!canSubmit) return;
    setIsSubmitting(true);

    try {
      if (authProvider === "local") {
        const response = await fetch(
          mode === "sign-up" ? "/api/auth/local/register" : "/api/auth/local/login",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              displayName: displayName.trim(),
              email: email.trim(),
              password,
            }),
          },
        );
        if (!response.ok) throw new Error("Local authentication failed.");
        router.refresh();
        return;
      }

      const { createSupabaseBrowserClient } = await import("@/modules/auth/supabase-browser");
      const supabase = createSupabaseBrowserClient();
      if (mode === "sign-up") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: displayName.trim() },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) throw error;

        if (data.session) {
          router.refresh();
          return;
        }
        setMessage("Check your inbox for a confirmation link. If you already have an account, sign in instead.");
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      router.refresh();
    } catch {
      setErrorMessage(
        mode === "sign-up"
          ? "We couldn't create your account. Check the details and try again."
          : "We couldn't sign you in. Check your email and password.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function sendResetEmail() {
    setMessage(null);
    setErrorMessage(null);
    if (authProvider === "local") {
      setShowResetHelp(true);
      return;
    }
    if (!emailIsValid) {
      setEmailTouched(true);
      setErrorMessage("Enter the email address for your account first.");
      return;
    }

    setIsSendingReset(true);
    try {
      const { createSupabaseBrowserClient } = await import("@/modules/auth/supabase-browser");
      await createSupabaseBrowserClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/reset`,
      });
      setMessage("If an account exists for that address, a recovery link is on its way.");
    } catch {
      setErrorMessage("A recovery email could not be sent. Try again in a moment.");
    } finally {
      setIsSendingReset(false);
    }
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setDisplayName("");
    setEmail("");
    setPassword("");
    setShowPassword(false);
    setPasswordFocused(false);
    setEmailTouched(false);
    setPasswordTouched(false);
    setNameTouched(false);
    setMessage(null);
    setErrorMessage(null);
    setShowResetHelp(false);
  }

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }

  return (
    <main className="relative flex min-h-dvh flex-col text-ink">
      <header className="flex h-16 shrink-0 items-center justify-between px-5 sm:px-8">
        <div className="flex items-center gap-2.5">
          <Logo className="h-8 w-8" />
          <div>
            <span className="block text-sm font-semibold tracking-[-0.02em]">Atlas</span>
            <span className="hidden text-[11px] text-faint sm:block">Knowledge, grounded.</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {authProvider === "local" && (
            <span className="hidden rounded-full border border-line bg-raised px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted sm:inline">
              Local mode
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            onClick={toggleTheme}
            className="rounded-full border border-line bg-[var(--surface-solid)] text-muted hover:text-ink"
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </Button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center px-4 py-8">
        <section className="w-full max-w-md" aria-label="Authentication">
          <div
            key={mode}
            className="animate-panel rounded-[var(--radius-container)] border border-line bg-surface-solid p-5 sm:p-6"
          >
            <div className="mb-5">
              <h1 className="text-[22px] font-semibold tracking-[-0.025em] text-ink">
                {mode === "sign-in" ? "Welcome back" : "Create your account"}
              </h1>
              <p className="mt-1 text-[13px] leading-6 text-muted">
                {mode === "sign-in"
                  ? "Sign in to continue to your document workspace."
                  : "A calm, private space for your documents and ideas."}
              </p>
            </div>

            <Segmented
              options={modeOptions}
              value={mode}
              onChange={changeMode}
              ariaLabel="Authentication mode"
              className="mb-5"
            />

            <form className="animate-fade-up space-y-4" onSubmit={handleSubmit} noValidate>
              {mode === "sign-up" && (
                <Field label="Full name" htmlFor="signup-name" error={nameError}>
                  <Input
                    id="signup-name"
                    autoComplete="name"
                    name="signup-name"
                    maxLength={100}
                    placeholder="Ada Lovelace"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    onBlur={() => setNameTouched(true)}
                    invalid={Boolean(nameError)}
                    aria-describedby={nameError ? "signup-name-error" : undefined}
                  />
                </Field>
              )}

              <Field label="Email address" htmlFor="auth-email" error={emailError}>
                <Input
                  id="auth-email"
                  type="email"
                  autoComplete={mode === "sign-in" ? "username" : "email"}
                  name={mode === "sign-in" ? "username" : "signup-email"}
                  inputMode="email"
                  maxLength={254}
                  placeholder="you@company.com"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setEmailTouched(true);
                  }}
                  onBlur={() => setEmailTouched(true)}
                  invalid={Boolean(emailError)}
                  aria-describedby={emailError ? "auth-email-error" : undefined}
                />
              </Field>

              <Field
                label="Password"
                htmlFor="auth-password"
                error={passwordError}
                hint={
                  mode === "sign-in" ? (
                    <button
                      type="button"
                      onClick={() => void sendResetEmail()}
                      disabled={isSendingReset}
                      className="rounded font-medium text-accent-ink transition-opacity hover:opacity-80 disabled:opacity-60"
                    >
                      {isSendingReset ? "Sending recovery link…" : "Forgot password?"}
                    </button>
                  ) : undefined
                }
              >
                <div className="relative">
                  <Input
                    id="auth-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                    maxLength={mode === "sign-up" ? 20 : undefined}
                    placeholder={mode === "sign-in" ? "Your password" : "Create a strong password"}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setPasswordTouched(true);
                    }}
                    onFocus={() => {
                      if (mode === "sign-up") setPasswordFocused(true);
                    }}
                    onBlur={() => {
                      setPasswordTouched(true);
                      setPasswordFocused(false);
                    }}
                    invalid={Boolean(passwordError)}
                    className="pr-11"
                    aria-describedby={
                      mode === "sign-up" && passwordFocused
                        ? passwordError
                          ? "password-requirements auth-password-error"
                          : "password-requirements"
                        : passwordError
                          ? "auth-password-error"
                          : undefined
                    }
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
                {mode === "sign-up" && passwordFocused && (
                  <PasswordRequirements
                    id="password-requirements"
                    password={password}
                    size="compact"
                  />
                )}
              </Field>

              {message && <Notice tone="success">{message}</Notice>}
              {errorMessage && <Notice tone="error">{errorMessage}</Notice>}
              {showResetHelp && (
                <Notice tone="info">
                  Atlas is running in local mode. Sign in, then change your password from{" "}
                  <span className="font-medium text-ink">Account → My account</span>.
                </Notice>
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={isSubmitting}
                className="mt-1"
              >
                {isSubmitting
                  ? mode === "sign-in"
                    ? "Signing in…"
                    : "Creating account…"
                  : mode === "sign-in"
                    ? "Sign in"
                    : "Create account"}
                {!isSubmitting && <ArrowRight size={15} />}
              </Button>
            </form>
          </div>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11.5px] leading-5 text-faint">
            <ShieldCheck size={13} />
            Your workspace is private to your account.
          </p>
        </section>
      </div>
    </main>
  );
}
