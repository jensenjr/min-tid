// Sync API client — all communication with the min-tid backend.
// The backend stores a JSON blob per user; no personal identifiers, only the data you explicitly sync.

export interface SyncState {
  name: string;
  department?: string;
  schedule: unknown;
  sessions: unknown[];
  absences: unknown[];
  expenses: unknown[];
  flexBaseMinutes: number;
  trackingStartDate?: string;
  scheduleExceptions?: unknown;
}

// Base URL — empty string in dev (Vite proxies /api → localhost:3001)
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

export async function syncRegister(username: string, secret: string): Promise<{ userId: string; token: string }> {
  return call("/api/auth/register", { method: "POST", body: JSON.stringify({ username, secret }) });
}

export async function syncLogin(username: string, secret: string): Promise<{ userId: string; token: string; state: SyncState | null }> {
  return call("/api/auth/login", { method: "POST", body: JSON.stringify({ username, secret }) });
}

export async function syncPush(token: string, state: SyncState): Promise<void> {
  await call("/api/sync", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ state }),
  });
}

export async function syncPull(token: string): Promise<SyncState | null> {
  const { state } = await call<{ state: SyncState | null }>("/api/sync", {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  return state;
}

export async function syncDeleteAccount(token: string): Promise<void> {
  await call("/api/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
}

export async function syncChangeSecret(token: string, newSecret: string): Promise<void> {
  await call("/api/auth/secret", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ newSecret }),
  });
}

export async function syncSendPhoneCode(token: string, phone: string): Promise<void> {
  await call("/api/auth/phone", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ phone }),
  });
}

export async function syncVerifyPhone(token: string, phone: string, code: string): Promise<void> {
  await call("/api/auth/phone/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ phone, code }),
  });
}

export async function syncRecoverRequest(phone: string): Promise<void> {
  await call("/api/auth/recover/request", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export async function syncRecoverConfirm(phone: string, code: string): Promise<{ username: string; token: string; state: SyncState | null }> {
  return call("/api/auth/recover/confirm", {
    method: "POST",
    body: JSON.stringify({ phone, code }),
  });
}

export const SYNC_TOKEN_KEY    = "sync_token";
export const SYNC_USERNAME_KEY = "sync_username";
export const SYNC_PHONE_KEY    = "sync_phone";
