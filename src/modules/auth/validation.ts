const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 20;
export const MAX_LOGIN_PASSWORD_LENGTH = 128;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_DISPLAY_NAME_LENGTH = 100;

export type PasswordRequirement = {
  label: string;
  valid: boolean;
};

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

export function getPasswordRequirements(password: string): PasswordRequirement[] {
  return [
    {
      label: `${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`,
      valid: password.length >= MIN_PASSWORD_LENGTH && password.length <= MAX_PASSWORD_LENGTH,
    },
    { label: "Uppercase letter", valid: /[A-Z]/.test(password) },
    { label: "Lowercase letter", valid: /[a-z]/.test(password) },
    { label: "Number", valid: /[0-9]/.test(password) },
    { label: "Symbol", valid: /[^A-Za-z0-9]/.test(password) },
  ];
}

export function isStrongPassword(password: string): boolean {
  return getPasswordRequirements(password).every((requirement) => requirement.valid);
}
