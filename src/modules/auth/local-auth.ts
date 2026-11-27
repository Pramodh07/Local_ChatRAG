import "server-only";

import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { AccountInfo } from "@/modules/auth/types";
import {
  isStrongPassword,
  isValidEmail,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_LOGIN_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@/modules/auth/validation";
import { isRecord } from "@/modules/shared/lib/guards";
import { createJsonStore } from "@/modules/shared/lib/json-store";
import { readJsonBody } from "@/modules/shared/lib/request";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_HASH_BYTES = 64;
const MAX_TOKEN_LENGTH = 128;

export const LOCAL_AUTH_COOKIE = "atlas-local-session";

type LocalUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  passwordSalt: string;
  passwordHash: string;
  createdAt: string;
};

type LocalSession = {
  id: string;
  tokenHash: string;
  userId: string;
  expiresAt: string;
};

type LocalAuthStore = {
  version: 1;
  users: LocalUser[];
  sessions: LocalSession[];
};

type LocalAuthResult = {
  account: AccountInfo;
  token: string;
};

export type LocalAuthPayload = {
  email: string;
  password: string;
  displayName?: string;
};

function isLocalUser(value: unknown): value is LocalUser {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.email === "string" &&
    typeof value.displayName === "string" &&
    (value.avatarUrl === undefined || value.avatarUrl === null || typeof value.avatarUrl === "string") &&
    typeof value.passwordSalt === "string" &&
    typeof value.passwordHash === "string" &&
    typeof value.createdAt === "string"
  );
}

function isLocalSession(value: unknown): value is LocalSession {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.tokenHash === "string" &&
    typeof value.userId === "string" &&
    typeof value.expiresAt === "string"
  );
}

function isLocalAuthStore(value: unknown): value is LocalAuthStore {
  return (
    isRecord(value) &&
    value.version === 1 &&
    Array.isArray(value.users) &&
    value.users.every(isLocalUser) &&
    Array.isArray(value.sessions) &&
    value.sessions.every(isLocalSession)
  );
}

const authStore = createJsonStore<LocalAuthStore>({
  fileName: "auth-store.json",
  createEmpty: () => ({ version: 1, users: [], sessions: [] }),
  validate: isLocalAuthStore,
  invalidJsonMessage: "The local auth store is not valid JSON.",
  unsupportedFormatMessage: "The local auth store has an unsupported format.",
});

function derivePasswordHash(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, PASSWORD_HASH_BYTES, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function verifyPassword(user: LocalUser | undefined, password: string): Promise<boolean> {
  // Hash even when the user is missing so response timing does not reveal valid emails.
  const salt = user ? Buffer.from(user.passwordSalt, "base64url") : randomBytes(16);
  const candidateHash = await derivePasswordHash(password, salt);
  if (!user) return false;

  const storedHash = Buffer.from(user.passwordHash, "base64url");
  return storedHash.length === candidateHash.length && timingSafeEqual(storedHash, candidateHash);
}

function findActiveSession(store: LocalAuthStore, tokenHash: string): LocalSession | undefined {
  const now = Date.now();
  return store.sessions.find(
    (session) => session.tokenHash === tokenHash && Date.parse(session.expiresAt) > now,
  );
}

function findUser(store: LocalAuthStore, userId: string): LocalUser | undefined {
  return store.users.find((user) => user.id === userId);
}

function toAccount(user: LocalUser): AccountInfo {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl ?? null,
  };
}

function pruneExpiredSessions(store: LocalAuthStore, now = Date.now()): boolean {
  const initialLength = store.sessions.length;
  store.sessions = store.sessions.filter((session) => Date.parse(session.expiresAt) > now);
  return store.sessions.length !== initialLength;
}

function createSession(store: LocalAuthStore, user: LocalUser): LocalAuthResult {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  pruneExpiredSessions(store, now);
  store.sessions.push({
    id: randomUUID(),
    tokenHash: hashSessionToken(token),
    userId: user.id,
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  });
  return { account: toAccount(user), token };
}

export async function parseLocalAuthPayload(
  request: Request,
  requireDisplayName: boolean,
): Promise<LocalAuthPayload | null> {
  const body = await readJsonBody(request, { maxBytes: 16_384 });
  if (!body.ok) return null;
  const value = body.data;
  if (!isRecord(value) || typeof value.email !== "string" || typeof value.password !== "string") {
    return null;
  }

  const email = value.email.trim();
  const password = value.password;
  if (
    email.length > MAX_EMAIL_LENGTH ||
    !isValidEmail(email) ||
    (requireDisplayName
      ? !isStrongPassword(password)
      : password.length < MIN_PASSWORD_LENGTH || password.length > MAX_LOGIN_PASSWORD_LENGTH)
  ) {
    return null;
  }

  if (requireDisplayName) {
    if (typeof value.displayName !== "string") return null;
    const displayName = value.displayName.trim();
    if (!displayName || displayName.length > MAX_DISPLAY_NAME_LENGTH) return null;
    return { email, password, displayName };
  }
  return { email, password };
}

export async function createLocalAccount(
  email: string,
  displayName: string,
  password: string,
): Promise<LocalAuthResult | null> {
  const normalizedEmail = email.trim().toLowerCase();
  return authStore.mutate(async (store) => {
    if (store.users.some((user) => user.email === normalizedEmail)) {
      return { result: null, changed: false };
    }

    const salt = randomBytes(16);
    const passwordHash = await derivePasswordHash(password, salt);
    const user: LocalUser = {
      id: randomUUID(),
      email: normalizedEmail,
      displayName: displayName.trim(),
      passwordSalt: salt.toString("base64url"),
      passwordHash: passwordHash.toString("base64url"),
      createdAt: new Date().toISOString(),
    };
    store.users.push(user);
    return { result: createSession(store, user), changed: true };
  });
}

export async function signInLocalAccount(
  email: string,
  password: string,
): Promise<LocalAuthResult | null> {
  const normalizedEmail = email.trim().toLowerCase();
  return authStore.mutate(async (store) => {
    const user = store.users.find((candidate) => candidate.email === normalizedEmail);
    if (!(await verifyPassword(user, password)) || !user) {
      return { result: null, changed: false };
    }
    return { result: createSession(store, user), changed: true };
  });
}

export async function changeLocalPassword(
  token: string | undefined,
  currentPassword: string,
  newPassword: string,
): Promise<LocalAuthResult | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH || !isStrongPassword(newPassword)) return null;

  const tokenHash = hashSessionToken(token);
  return authStore.mutate(async (store) => {
    const session = findActiveSession(store, tokenHash);
    const user = session ? findUser(store, session.userId) : undefined;
    if (!user || !(await verifyPassword(user, currentPassword))) {
      return { result: null, changed: false };
    }

    const salt = randomBytes(16);
    const passwordHash = await derivePasswordHash(newPassword, salt);
    user.passwordSalt = salt.toString("base64url");
    user.passwordHash = passwordHash.toString("base64url");
    store.sessions = store.sessions.filter((candidate) => candidate.userId !== user.id);
    return { result: createSession(store, user), changed: true };
  });
}

export async function updateLocalAvatar(
  token: string | undefined,
  avatarUrl: string | null,
): Promise<AccountInfo | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const tokenHash = hashSessionToken(token);
  return authStore.mutate((store) => {
    pruneExpiredSessions(store);
    const session = findActiveSession(store, tokenHash);
    const user = session ? findUser(store, session.userId) : undefined;
    if (!user) return { result: null, changed: false };

    user.avatarUrl = avatarUrl;
    return { result: toAccount(user), changed: true };
  });
}

export async function getLocalAccount(token: string | undefined): Promise<AccountInfo | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const store = await authStore.read();
  const session = findActiveSession(store, hashSessionToken(token));
  const user = session ? findUser(store, session.userId) : undefined;
  return user ? toAccount(user) : null;
}

export async function revokeLocalSession(token: string | undefined): Promise<void> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return;
  const tokenHash = hashSessionToken(token);
  await authStore.mutate((store) => {
    const now = Date.now();
    const sessions = store.sessions.filter(
      (session) => session.tokenHash !== tokenHash && Date.parse(session.expiresAt) > now,
    );
    const changed = sessions.length !== store.sessions.length;
    store.sessions = sessions;
    return { result: undefined, changed };
  });
}

export function setLocalSessionCookie(
  response: NextResponse,
  requestUrl: string,
  token: string,
): void {
  response.cookies.set(LOCAL_AUTH_COOKIE, token, {
    httpOnly: true,
    maxAge: SESSION_TTL_MS / 1000,
    path: "/",
    sameSite: "lax",
    secure: new URL(requestUrl).protocol === "https:",
  });
}

export function clearLocalSessionCookie(response: NextResponse, requestUrl: string): void {
  response.cookies.set(LOCAL_AUTH_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: new URL(requestUrl).protocol === "https:",
  });
}
