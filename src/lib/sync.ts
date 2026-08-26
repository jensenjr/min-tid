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

/**
 * A failed sync call, with enough context for the diagnostics panel and the
 * felanmälan. `status === 0` means the request never got a response at all —
 * offline, DNS, TLS, or a network that swallows it (captive portal, filter).
 */
export class SyncApiError extends Error {
  status: number;
  path: string;
  method: string;
  constructor(message: string, status: number, path: string, method: string) {
    super(message);
    this.name = "SyncApiError";
    this.status = status;
    this.path = path;
    this.method = method;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      ...init,
    });
  } catch {
    // fetch only rejects when the request never completed.
    throw new SyncApiError(
      navigator.onLine ? "Ingen kontakt med servern (blockerad eller otillgänglig)." : "Enheten är offline.",
      0, path, method,
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new SyncApiError((body as { error?: string }).error ?? `HTTP ${res.status}`, res.status, path, method);
  }
  return body as T;
}

export async function syncRegister(username: string, secret: string): Promise<{ userId: string; token: string }> {
  return call("/api/auth/register", { method: "POST", body: JSON.stringify({ username, secret }) });
}

export async function syncLogin(username: string, secret: string): Promise<{ userId: string; token: string; state: SyncState | null; updatedAt: number }> {
  return call("/api/auth/login", { method: "POST", body: JSON.stringify({ username, secret }) });
}

/** Push the full state blob. Returns the server's new revision marker. */
export async function syncPush(token: string, state: SyncState): Promise<number> {
  const { updatedAt } = await call<{ ok: boolean; updatedAt: number }>("/api/sync", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ state }),
  });
  return updatedAt ?? 0;
}

/** Fetch the stored state plus its revision marker (0 when nothing is stored yet). */
export async function syncPull(token: string): Promise<{ state: SyncState | null; updatedAt: number }> {
  const { state, updatedAt } = await call<{ state: SyncState | null; updatedAt: number }>("/api/sync", {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  return { state, updatedAt: updatedAt ?? 0 };
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

export async function syncRecoverConfirm(phone: string, code: string): Promise<{ username: string; token: string; state: SyncState | null; updatedAt: number }> {
  return call("/api/auth/recover/confirm", {
    method: "POST",
    body: JSON.stringify({ phone, code }),
  });
}

export const SYNC_TOKEN_KEY    = "sync_token";
/** Last server revision this device has seen (pushed or pulled). */
export const SYNC_REV_KEY      = "sync_rev";
/** "1" while this device holds local changes that have not reached the server. */
export const SYNC_DIRTY_KEY    = "sync_dirty";
export const SYNC_USERNAME_KEY = "sync_username";
export const SYNC_PHONE_KEY    = "sync_phone";
