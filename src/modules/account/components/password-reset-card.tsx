"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { Eye, EyeOff, KeyRound } from "@/modules/shared/components/icons";
import type { AccountInfo, AuthProvider } from "@/modules/auth/types";
import { isStrongPassword } from "@/modules/auth/validation";
import { PasswordRequirements } from "@/modules/auth/components/password-requirements";
import { errorMessageFromPayload } from "@/modules/shared/lib/http";
import { Button } from "@/modules/shared/components/ui/button";
import { Card, CardHeader } from "@/modules/shared/components/ui/card";
import { Field, Input } from "@/modules/shared/components/ui/field";
import { Notice } from "@/modules/shared/components/ui/notice";

type PasswordField = "currentPassword" | "newPassword" | "confirmPassword";

const fields: Array<{
  id: PasswordField;
  label: string;
  autoComplete: "current-password" | "new-password";
}> = [
  { id: "currentPassword", label: "Current password", autoComplete: "current-password" },
  { id: "newPassword", label: "New password", autoComplete: "new-password" },
  { id: "confirmPassword", label: "Confirm new password", autoComplete: "new-password" },
];

type PasswordResetCardProps = {
  account: AccountInfo;
  authProvider: AuthProvider;
};

export function PasswordResetCard({ account, authProvider }: PasswordResetCardProps) {
  const [passwords, setPasswords] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [visibleFields, setVisibleFields] = useState<PasswordField[]>([]);
  const [touchedFields, setTouchedFields] = useState<PasswordField[]>([]);
  const [newPasswordFocused, setNewPasswordFocused] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const requirementsValid = isStrongPassword(passwords.newPassword);
  const passwordsMatch =
    passwords.confirmPassword.length > 0 &&
    passwords.newPassword === passwords.confirmPassword;
  const passwordIsDifferent = passwords.newPassword !== passwords.currentPassword;
  const canSubmit =
    passwords.currentPassword.length > 0 &&
    passwords.currentPassword.length <= 128 &&
    requirementsValid &&
    passwordsMatch &&
    passwordIsDifferent &&
    !isSubmitting;

  function fieldError(field: PasswordField): string | null {
    if (!touchedFields.includes(field)) return null;
    if (field === "currentPassword" && !passwords.currentPassword) {
      return "Enter your current password.";
    }
    if (field === "newPassword" && !requirementsValid) {
      return "Complete every password requirement.";
    }
    if (field === "newPassword" && !passwordIsDifferent) {
      return "Choose a password different from your current one.";
    }
    if (field === "confirmPassword" && !passwordsMatch) {
      return passwords.confirmPassword
        ? "Passwords do not match."
        : "Confirm your new password.";
    }
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouchedFields(fields.map((field) => field.id));
    setErrorMessage(null);
    setNotice(null);
    if (!canSubmit) return;

    setIsSubmitting(true);
    try {
      if (authProvider === "local") {
        const response = await fetch("/api/auth/local/password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentPassword: passwords.currentPassword,
            newPassword: passwords.newPassword,
          }),
        });
        const payload: unknown = await response.json();
        if (!response.ok) {
          throw new Error(errorMessageFromPayload(payload, "Password could not be updated."));
        }
      } else {
        const { createSupabaseBrowserClient } = await import("@/modules/auth/supabase-browser");
        const supabase = createSupabaseBrowserClient();
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: account.email,
          password: passwords.currentPassword,
        });
        if (signInError) throw new Error("Your current password is incorrect.");

        const { error: updateError } = await supabase.auth.updateUser({
          password: passwords.newPassword,
        });
        if (updateError) throw new Error(updateError.message);
      }

      setPasswords({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setTouchedFields([]);
      setVisibleFields([]);
      setNewPasswordFocused(false);
      setNotice("Your password has been updated.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Password could not be updated.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <div className="p-5 sm:p-6">
        <CardHeader
          icon={<KeyRound size={15} />}
          title="Password"
          description="Verify your current password, then choose a new one."
        />

        <form className="mt-5 max-w-md space-y-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
          {fields.map(({ id, label, autoComplete }) => {
            const error = fieldError(id);
            const isVisible = visibleFields.includes(id);
            return (
              <Field key={id} label={label} htmlFor={id} error={error}>
                <div className="relative">
                  <Input
                    id={id}
                    type={isVisible ? "text" : "password"}
                    autoComplete={autoComplete}
                    maxLength={id === "currentPassword" ? 128 : 20}
                    value={passwords[id]}
                    onChange={(event) => {
                      setPasswords((current) => ({ ...current, [id]: event.target.value }));
                      setTouchedFields((current) => current.includes(id) ? current : [...current, id]);
                      setErrorMessage(null);
                    }}
                    onFocus={() => {
                      if (id === "newPassword") setNewPasswordFocused(true);
                    }}
                    onBlur={() => {
                      setTouchedFields((current) => current.includes(id) ? current : [...current, id]);
                      if (id === "newPassword") setNewPasswordFocused(false);
                    }}
                    invalid={Boolean(error)}
                    className="pr-11"
                    aria-describedby={error ? `${id}-error` : undefined}
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-[10px] text-muted transition-colors hover:text-ink"
                    aria-label={isVisible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
                    aria-pressed={isVisible}
                    onClick={() =>
                      setVisibleFields((current) =>
                        isVisible ? current.filter((field) => field !== id) : [...current, id],
                      )
                    }
                  >
                    {isVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {id === "newPassword" && newPasswordFocused && (
                  <PasswordRequirements password={passwords.newPassword} size="compact" />
                )}
              </Field>
            );
          })}

          {errorMessage && <Notice tone="error">{errorMessage}</Notice>}
          {notice && <Notice tone="success">{notice}</Notice>}

          <Button type="submit" variant="primary" disabled={!canSubmit} loading={isSubmitting}>
            {isSubmitting ? "Updating password…" : "Update password"}
          </Button>
        </form>
      </div>
    </Card>
  );
}
