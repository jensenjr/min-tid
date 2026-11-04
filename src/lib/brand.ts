import { resolveAppName } from "./brandText";

/**
 * The product name shown to users. min-tid by default; a derived product (Timsam) sets
 * VITE_APP_NAME at build time and needs no code changes. Storage keys, IndexedDB names and
 * crypto labels are NOT branded on purpose: they are protocol/data identifiers.
 */
export const APP_NAME = resolveAppName(import.meta.env.VITE_APP_NAME);
