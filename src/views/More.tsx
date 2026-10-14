import { useState } from "react";
import { ABSENCE_META, type AbsenceCategory } from "../components/AbsenceModal";
import SyncSecuritySheet, { type SyncStatus } from "../components/SyncSecuritySheet";
import { MoreRow, Sheet } from "../components/ui";
import type { ReportingMode } from "../lib/types";
import type { MoreSlots } from "./types";

// Categories that are paid from the flex bank; every other category lowers the day's norm.
const FLEX_CATEGORIES: AbsenceCategory[] = ["flex"];

function AbsenceRulesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const entries = Object.entries(ABSENCE_META) as [
    AbsenceCategory,
    { emoji: string; label: string },
  ][];
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Frånvaroregler"
      subtitle="Så räknas frånvaro och rast i flexsaldot."
    >
      <ul className="space-y-2 text-[13px] leading-snug mb-5">
        <li>
          <b>Bara schemalagda dagar.</b> Frånvaro på en ledig dag räknas inte — en semestervecka
          kostar alltså bara de dagar du hade schemalagd tid.
        </li>
        <li>
          <b>Hel dag eller timmar.</b> Hel dag är dagens hela norm; annars anger du timmar per dag.
        </li>
        <li>
          <b>Flex tas från flexsaldot.</b> Alla andra kategorier minskar dagens norm i stället.
        </li>
        <li>
          <b>Aldrig mer än normen.</b> Frånvaro tillsammans kan inte överstiga dagens norm.
        </li>
        <li>
          <b>Lunch.</b> Schemats lunch dras bara av när du har ett enda pass längre än 5 timmar. Har
          du stämplat ut över lunchen dras inget av. En rast du anger själv gäller alltid.
        </li>
      </ul>
      <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-2">
        Kategorier
      </div>
      <div className="rounded-[16px] border border-pc-line overflow-hidden mb-5">
        {entries.map(([key, meta]) => (
          <div
            key={key}
            className="flex items-center gap-3 px-4 py-2.5 border-t border-pc-line first:border-t-0"
          >
            <span className="text-[18px] leading-none">{meta.emoji}</span>
            <span className="flex-1 text-[14px] font-bold">{meta.label}</span>
            <span className="text-[11px] font-bold text-pc-muted">
              {FLEX_CATEGORIES.includes(key) ? "Tas från flex" : "Minskar normen"}
            </span>
          </div>
        ))}
      </div>
      <button
        onClick={onClose}
        className="pc-press w-full py-3.5 rounded-[16px] bg-pc-bg border border-pc-line font-bold text-[14px] text-pc-ink"
      >
        Stäng
      </button>
    </Sheet>
  );
}

function AboutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Om appen" subtitle={`min-tid v${__APP_VERSION__}`}>
      <div className="space-y-3 text-[13px] leading-snug mb-5">
        <p>min-tid är din egen tidrapport: schema, frånvaro, flex och utlägg på ett ställe.</p>
        <p>
          <b>Din data ligger på enheten.</b> Synk mellan enheter är valfri och krypteras på enheten
          innan den skickas — servern kan inte läsa den.
        </p>
        <p>
          <b>Enligt schema</b> betyder att schemat är din tid och du bara anger det som avviker.{" "}
          <b>Stämpla</b> betyder att du checkar in och ut. Du byter under Schema & rapportläge.
        </p>
      </div>
      <button
        onClick={onClose}
        className="pc-press w-full py-3.5 rounded-[16px] bg-pc-bg border border-pc-line font-bold text-[14px] text-pc-ink"
      >
        Stäng
      </button>
    </Sheet>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-pc-muted mb-2 px-1">
        {title}
      </div>
      <div className="bg-white rounded-[22px] border border-pc-line shadow-[0_2px_12px_rgba(81,43,43,0.04)] overflow-hidden">
        {children}
      </div>
    </div>
  );
}

export type MoreProps = {
  name: string;
  department?: string;
  mode: ReportingMode;
  syncToken: string | null;
  syncStatus: SyncStatus;
  syncedAt: number | null;
  syncDirty: boolean;
  /** Edit name and department (SettingsModal). */
  onOpenProfile: () => void;
  /** "Schema & rapportläge" (ScheduleEditorModal). */
  onOpenSchedule: () => void;
  /** Activate sync / log in again (SyncModal). */
  onSetupSync: () => void;
  /** Sync code, phone, disconnect, troubleshooting (SettingsModal). */
  onOpenSyncAccount: () => void;
  onPullNow: () => void;
  onOpenAutomation: () => void;
  /** Demo mode: sync is off and the sheet says so. */
  demo?: boolean;
  /** Wave 3 integration slots: travelRules (PR 8), vacation (PR 7), excelImport (PR 6). */
  slots?: MoreSlots;
};

/**
 * Mer: every settings entry point. Rows for PRs 6–8 are slots and render nothing until
 * they are filled.
 */
export default function More(p: MoreProps) {
  const [rules, setRules] = useState(false);
  const [about, setAbout] = useState(false);
  const [sync, setSync] = useState(false);
  const initial = (p.name.trim()[0] ?? "?").toUpperCase();

  return (
    <div className="pc-fade pt-2 pb-4">
      <h1 className="text-[28px] font-extrabold tracking-tight mb-4">Mer</h1>

      <button
        onClick={p.onOpenProfile}
        className="pc-press w-full flex items-center gap-3 bg-white rounded-[22px] border border-pc-line shadow-[0_2px_12px_rgba(81,43,43,0.04)] px-4 py-4 mb-5 text-left"
      >
        <span className="w-11 h-11 rounded-2xl bg-pc-orange text-white flex items-center justify-center font-extrabold text-[18px] shrink-0">
          {initial}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-extrabold text-[16px] truncate">{p.name || "—"}</span>
          <span className="block text-[12px] text-pc-muted font-medium truncate">
            {p.department ? `${p.department} · ` : ""}Redigera profil
          </span>
        </span>
        <span className="text-pc-muted">›</span>
      </button>

      <Group title="Tid och regler">
        <MoreRow
          icon="📅"
          title="Schema & rapportläge"
          subtitle={p.mode === "schedule" ? "Rapportläge: Enligt schema" : "Rapportläge: Stämpla"}
          onClick={p.onOpenSchedule}
        />
        <MoreRow
          icon="📋"
          title="Frånvaroregler"
          subtitle="Så räknas frånvaro, flex och lunch"
          onClick={() => setRules(true)}
        />
        {p.slots?.travelRules}
        {p.slots?.vacation}
      </Group>

      <Group title="Data">
        <MoreRow
          icon="🔒"
          title="Synk och säkerhet"
          subtitle={
            p.demo
              ? "Av i demoläget"
              : p.syncToken
                ? "Krypterad synk är på · AES-256"
                : "Krypterad på enheten · AES-256"
          }
          onClick={() => setSync(true)}
        />
        {p.slots?.excelImport}
      </Group>

      <Group title="Övrigt">
        <MoreRow
          icon="⚡"
          title="Automatisering"
          subtitle="QR-koder, NFC-taggar och WiFi via Genvägar"
          onClick={p.onOpenAutomation}
        />
        <MoreRow
          icon="ℹ️"
          title="Om appen"
          subtitle={`Version ${__APP_VERSION__}`}
          onClick={() => setAbout(true)}
        />
      </Group>

      <AbsenceRulesSheet open={rules} onClose={() => setRules(false)} />
      <AboutSheet open={about} onClose={() => setAbout(false)} />
      <SyncSecuritySheet
        open={sync}
        onClose={() => setSync(false)}
        syncToken={p.syncToken}
        syncStatus={p.syncStatus}
        syncedAt={p.syncedAt}
        dirty={p.syncDirty}
        demo={p.demo}
        onPullNow={p.onPullNow}
        onSetupSync={() => {
          setSync(false);
          p.onSetupSync();
        }}
        onOpenAccount={() => {
          setSync(false);
          p.onOpenSyncAccount();
        }}
      />
    </div>
  );
}
