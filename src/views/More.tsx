import { useState } from "react";
import { APP_NAME } from "../lib/brand";
import { ABSENCE_META, type AbsenceCategory } from "../components/AbsenceModal";
import AppearanceSheet from "../components/AppearanceSheet";
import { appearanceSummary, useAppearance } from "../lib/useAppearance";
import SyncSecuritySheet, { type SyncStatus } from "../components/SyncSecuritySheet";
import { MoreRow, Sheet } from "../components/ui";
import { CHANGELOG_URL, RELEASE_NOTES, fmtReleaseDate } from "../lib/releaseNotes";
import { REPORT_STYLES, reportStyle, reportStyleSummary } from "../lib/reportStyle";
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

/** Mer → "Hur du rapporterar": Stämplare or Justerare. Applied at once. */
function ReportStyleSheet({
  open,
  mode,
  onChange,
  onClose,
}: {
  open: boolean;
  mode: ReportingMode;
  onChange: (mode: ReportingMode) => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Hur du rapporterar"
      subtitle="Avgör vad startsidan visar först. Du kan alltid göra båda, och flexen räknas likadant."
    >
      <div className="space-y-3 mb-5" role="radiogroup" aria-label="Hur du rapporterar">
        {REPORT_STYLES.map((o) => {
          const on = mode === o.key;
          return (
            <button
              key={o.key}
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.key)}
              className="pc-press w-full text-left rounded-[18px] px-4 py-3.5 flex items-start gap-3"
              style={{
                background: on ? "var(--pc-orange-tint)" : "var(--pc-apricot)",
                border: on ? "2px solid var(--pc-orange)" : "2px solid var(--pc-line)",
              }}
            >
              <span className="text-[22px] leading-none mt-0.5 shrink-0">{o.icon}</span>
              <span className="flex-1">
                <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-pc-muted">
                  {o.role}
                </span>
                <span
                  className="block font-extrabold text-[15px] leading-tight mb-1"
                  style={{ color: on ? "var(--pc-orange-deep)" : "var(--pc-ink)" }}
                >
                  {o.title}
                </span>
                <span className="block text-[12px] text-pc-muted leading-snug">{o.text}</span>
              </span>
            </button>
          );
        })}
      </div>
      <button
        onClick={onClose}
        className="pc-press w-full py-3.5 rounded-[16px] bg-pc-orange text-white font-bold text-[14px]"
      >
        Klar
      </button>
    </Sheet>
  );
}

function AboutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Om appen"
      subtitle={`${APP_NAME} v${__APP_VERSION__}`}
    >
      <div className="space-y-3 text-[13px] leading-snug mb-5">
        <p>{APP_NAME} är din egen tidrapport: schema, frånvaro, flex och utlägg på ett ställe.</p>
        <p>
          <b>Din data ligger på enheten.</b> Synk mellan enheter är valfri och krypteras på enheten
          innan den skickas — servern kan inte läsa den.
        </p>
        <p>
          <b>Stämplare</b> checkar in och ut och får exakta minuter. <b>Justerare</b> följer schemat
          och anger bara avvikelser. Båda kan göra båda; du byter under Hur du rapporterar.
        </p>
      </div>

      <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-pc-muted mb-2 px-1">
        Nytt i versionen
      </div>
      <div className="space-y-3 mb-3">
        {RELEASE_NOTES.map((r, i) => (
          <div
            key={r.version}
            className={`rounded-[18px] border px-4 py-3 ${
              i === 0 ? "border-pc-orange-line bg-pc-peach" : "border-pc-line bg-pc-apricot"
            }`}
          >
            <div className="flex items-baseline justify-between gap-2 mb-1.5">
              <span
                className={`font-extrabold text-[14px] ${i === 0 ? "text-pc-orange-deep" : "text-pc-ink"}`}
              >
                v{r.version}
                {r.version === __APP_VERSION__ && (
                  <span className="ml-2 text-[11px] font-bold text-pc-muted">din version</span>
                )}
              </span>
              <span className="text-[11px] font-semibold text-pc-muted shrink-0">
                {fmtReleaseDate(r.date)}
              </span>
            </div>
            <ul className="space-y-1 text-[13px] leading-snug text-pc-ink">
              {r.notes.map((n) => (
                <li key={n} className="flex gap-2">
                  <span className="text-pc-muted shrink-0">•</span>
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <a
        href={CHANGELOG_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-center text-[13px] font-bold text-pc-orange-deep underline mb-5"
      >
        Hela ändringsloggen på GitHub ↗
      </a>
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
      <div className="bg-pc-surface rounded-[22px] border border-pc-line shadow-[0_2px_12px_rgba(81,43,43,0.04)] overflow-hidden">
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
  /** "Schema" (ScheduleEditorModal). */
  onOpenSchedule: () => void;
  /** "Hur du rapporterar": Stämplare ("punch") or Justerare ("schedule"). */
  onSetMode: (mode: ReportingMode) => void;
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
  const [appearance, setAppearance] = useState(false);
  const [style, setStyle] = useState(false);
  const look = useAppearance();
  const initial = (p.name.trim()[0] ?? "?").toUpperCase();

  return (
    <div className="pc-fade pt-2 pb-4">
      <h1 className="text-[28px] font-extrabold tracking-tight mb-4">Mer</h1>

      <button
        onClick={p.onOpenProfile}
        className="pc-press w-full flex items-center gap-3 bg-pc-surface rounded-[22px] border border-pc-line shadow-[0_2px_12px_rgba(81,43,43,0.04)] px-4 py-4 mb-5 text-left"
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

      {/* Two columns of groups on desktop. */}
      <div className="md:grid md:grid-cols-2 md:gap-x-6 md:items-start">
        <div>
          <Group title="Tid och regler">
            <MoreRow
              icon={reportStyle(p.mode).icon}
              title="Hur du rapporterar"
              subtitle={reportStyleSummary(p.mode)}
              onClick={() => setStyle(true)}
            />
            <MoreRow
              icon="📅"
              title="Schema"
              subtitle="Arbetstider, rotation och perioder"
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
        </div>

        <div>
          <Group title="Utseende">
            <MoreRow
              icon="🎨"
              title="Tema och färger"
              subtitle={appearanceSummary(look.theme, look.accent)}
              onClick={() => setAppearance(true)}
            />
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
        </div>
      </div>

      <AbsenceRulesSheet open={rules} onClose={() => setRules(false)} />
      <AboutSheet open={about} onClose={() => setAbout(false)} />
      <ReportStyleSheet
        open={style}
        mode={p.mode}
        onChange={p.onSetMode}
        onClose={() => setStyle(false)}
      />
      <AppearanceSheet open={appearance} onClose={() => setAppearance(false)} />
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
