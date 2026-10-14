import { useEffect, useMemo, useRef, useState } from "react";
import { parseWorkbook, type ParsedWorkbook } from "../lib/excel/parse";
import {
  type ImportPatch,
  type ImportPlan,
  type ImportableState,
  applyImportPlan,
  buildImportPlan,
  snapshotOf,
} from "../lib/excel/plan";
import { buildTemplate, TEMPLATE_FILENAME, XLSX_MIME } from "../lib/excel/template";
import { downloadBytes } from "../lib/excel/download";
import {
  type ImportUndo,
  clearImportUndo,
  readImportUndo,
  saveImportUndo,
} from "../lib/excel/undo";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_LISTED_ERRORS = 50;

type Step =
  | { kind: "idle" }
  | { kind: "parsing"; fileName: string }
  | { kind: "preview"; fileName: string; parsed: ParsedWorkbook }
  | { kind: "done"; message: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function fmtHours(minutes: number): string {
  const h = minutes / 60;
  const s = h.toLocaleString("sv-SE", { maximumFractionDigits: 2 });
  return `${h > 0 ? "+" : ""}${s.replace("-", "−")} h`;
}

function summaryOf(plan: ImportPlan): string {
  const parts: string[] = [];
  if (plan.sessions.length) parts.push(plural(plan.sessions.length, "pass", "pass"));
  if (plan.absences.length) parts.push(plural(plan.absences.length, "frånvaro", "frånvaro"));
  if (plan.expenses.length) parts.push(plural(plan.expenses.length, "utlägg", "utlägg"));
  if (plan.balances) parts.push("saldon");
  return parts.join(", ");
}

function fmtWhen(ms: number): string {
  return new Date(ms).toLocaleString("sv-SE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * "Importera från Excel": download the template, pick the filled-in file, preview counts and
 * row-numbered errors, import (a snapshot is stored first) and undo the last import.
 *
 * The modal owns no app state: it gets the importable slice and hands back a patch.
 * `onApply` must set every field of the patch (undefined clears it).
 */
export default function ImportModal({
  open,
  onClose,
  state,
  hasTravelSupport = false,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  state: ImportableState;
  /** PR 8 sets this once the app can store travel entries; until then Restid rows are only counted. */
  hasTravelSupport?: boolean;
  onApply: (patch: ImportPatch) => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [err, setErr] = useState("");
  const [undo, setUndo] = useState<ImportUndo | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setStep({ kind: "idle" });
      setErr("");
      setConfirmUndo(false);
      setBusy(false);
      setUndo(readImportUndo());
    }
  }, [open]);

  // The preview is always worked out against the state as it is right now.
  const plan = useMemo(
    () => (step.kind === "preview" ? buildImportPlan(step.parsed, state) : null),
    [step, state],
  );

  if (!open) return null;

  async function downloadTemplate() {
    setErr("");
    try {
      downloadBytes(await buildTemplate(), TEMPLATE_FILENAME, XLSX_MIME);
    } catch {
      setErr("Kunde inte skapa mallen. Försök igen.");
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setErr("");
    if (file.size > MAX_FILE_BYTES) {
      setErr("Filen är för stor (max 10 MB).");
      return;
    }
    setStep({ kind: "parsing", fileName: file.name });
    try {
      const parsed = await parseWorkbook(file);
      setStep({ kind: "preview", fileName: file.name, parsed });
    } catch {
      setStep({ kind: "idle" });
      setErr("Filen kunde inte läsas. Använd mallen och spara som .xlsx.");
    }
  }

  function doImport() {
    if (step.kind !== "preview") return;
    // Re-plan against the current state in case it changed while the preview was open.
    const fresh = buildImportPlan(step.parsed, state);
    if (fresh.empty) return;
    setBusy(true);
    const summary = summaryOf(fresh) || "saldon";
    const saved = saveImportUndo({ v: 1, at: Date.now(), summary, snapshot: snapshotOf(state) });
    if (!saved) {
      setBusy(false);
      setErr(
        "Kunde inte spara en kopia att ångra från (lagringsutrymmet är fullt eller blockerat). Importen avbröts och inget ändrades.",
      );
      return;
    }
    onApply(applyImportPlan(fresh, state));
    setUndo(readImportUndo());
    setBusy(false);
    setStep({
      kind: "done",
      message: `Importerade ${summary}.${
        fresh.travel.length > 0 && !hasTravelSupport
          ? ` ${plural(fresh.travel.length, "restid", "restider")} väntar – de importeras när restidsstöd finns.`
          : ""
      }`,
    });
  }

  function doUndo() {
    const u = readImportUndo();
    if (!u) {
      setUndo(null);
      setConfirmUndo(false);
      return;
    }
    onApply(u.snapshot);
    clearImportUndo();
    setUndo(null);
    setConfirmUndo(false);
    setStep({ kind: "done", message: "Importen är ångrad." });
  }

  const hasImportable = !!plan && !plan.empty;
  const shownErrors = plan ? plan.errors.slice(0, MAX_LISTED_ERRORS) : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(45,23,23,0.55)", animation: "pcOverlay 0.25s ease" }}
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-[480px] rounded-t-[28px] px-5 pt-6 overflow-y-auto"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 28px)",
          animation: "pcSheet 0.32s cubic-bezier(0.32,0.72,0,1)",
          maxHeight: "92dvh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-pc-line rounded-full mx-auto mb-5" />

        <div className="font-extrabold text-[22px] tracking-tight mb-1">Importera från Excel</div>
        <div className="text-[13px] text-pc-muted mb-5">
          Hämta mallen, fyll i din historik och läs in filen. Filen läses bara i din webbläsare –
          den skickas inte till någon server.
        </div>

        {err && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 text-red-700 text-[13px] font-semibold rounded-2xl px-4 py-3 mb-4"
          >
            {err}
          </div>
        )}

        {/* Step 1 + 2: template and file */}
        {(step.kind === "idle" || step.kind === "parsing") && (
          <div className="space-y-3 mb-2">
            <button
              onClick={downloadTemplate}
              className="pc-press w-full py-4 rounded-[18px] bg-white border border-pc-line text-pc-ink font-bold text-[15px]"
            >
              1. Ladda ner mallen (.xlsx)
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = ""; // choosing the same file again must re-run
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={step.kind === "parsing"}
              className="pc-press w-full py-4 rounded-[18px] bg-pc-orange text-white font-bold text-[15px] shadow-[0_8px_20px_-8px_rgba(255,95,0,0.6)] disabled:opacity-60"
            >
              {step.kind === "parsing" ? `Läser ${step.fileName}…` : "2. Välj ifylld fil"}
            </button>
          </div>
        )}

        {/* Step 3: preview */}
        {step.kind === "preview" && plan && (
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-pc-muted mb-2">
              Förhandsgranskning · {step.fileName}
            </div>
            <div className="bg-pc-apricot rounded-2xl px-4 py-3 mb-3 text-[14px] text-pc-ink space-y-1">
              <Line n={plan.sessions.length} label="pass" />
              <Line n={plan.absences.length} label="frånvaroperioder" />
              <Line n={plan.expenses.length} label="utlägg" />
              {plan.travel.length > 0 && (
                <div className="text-pc-muted">
                  {plural(plan.travel.length, "restid", "restider")}
                  {hasTravelSupport ? "" : " – importeras när restidsstöd finns"}
                </div>
              )}
              {plan.balances && (
                <div>
                  <span className="font-bold">Saldon per {plan.balances.asOf}</span>
                  {plan.balances.flexMinutes !== undefined && (
                    <span> · flex {fmtHours(plan.balances.flexMinutes)}</span>
                  )}
                  {plan.balances.vacationDaysLeft !== undefined && (
                    <span> · {plan.balances.vacationDaysLeft} semesterdagar kvar</span>
                  )}
                  {plan.balances.savedVacationDays !== undefined && (
                    <span> · {plan.balances.savedVacationDays} sparade</span>
                  )}
                </div>
              )}
            </div>

            <ul className="text-[12px] text-pc-muted space-y-1 mb-3 list-disc pl-5">
              {plan.duplicates.length > 0 && (
                <li>
                  {plural(plan.duplicates.length, "dubblett hoppas", "dubbletter hoppas")} över
                  (finns redan i filen eller i appen).
                </li>
              )}
              {plan.skippedExamples > 0 && (
                <li>
                  {plural(plan.skippedExamples, "exempelrad hoppas", "exempelrader hoppas")} över.
                </li>
              )}
              {plan.confirmedDays.length > 0 && (
                <li>
                  {plural(plan.confirmedDays.length, "dag markeras", "dagar markeras")} som
                  bekräftade.
                </li>
              )}
              {plan.trackingStartDate && plan.trackingStartDate !== state.trackingStartDate && (
                <li>Flex räknas från {plan.trackingStartDate}.</li>
              )}
              {plan.beforeBalance > 0 && (
                <li>
                  {plural(plan.beforeBalance, "post ligger", "poster ligger")} före eller på
                  saldodatumet och räknas inte in i flexsaldot (saldot gäller redan dem).
                </li>
              )}
              {plan.balances?.flexMinutes !== undefined && (
                <li>Ditt nuvarande flexsaldo ersätts av saldot i filen.</li>
              )}
            </ul>

            {plan.errors.length > 0 && (
              <div className="mb-3">
                <div className="text-[13px] font-bold text-red-700 mb-1">
                  {plural(plan.errors.length, "rad har fel", "rader har fel")} och hoppas över
                </div>
                <div className="text-[12px] text-pc-ink bg-red-50 border border-red-100 rounded-2xl px-3 py-2 max-h-48 overflow-y-auto space-y-1">
                  {shownErrors.map((e, i) => (
                    <div key={i}>
                      <span className="font-bold">
                        {e.sheet}
                        {e.row > 0 ? ` · rad ${e.row}` : ""}:
                      </span>{" "}
                      {e.message}
                    </div>
                  ))}
                  {plan.errors.length > shownErrors.length && (
                    <div className="text-pc-muted">
                      … och {plan.errors.length - shownErrors.length} till
                    </div>
                  )}
                </div>
                <div className="text-[12px] text-pc-muted mt-1">
                  Rätta raderna i filen och importera igen om du vill ha med dem – det som redan är
                  importerat känns igen som dubbletter.
                </div>
              </div>
            )}

            {!hasImportable && (
              <div className="text-[13px] text-pc-muted mb-3">
                Det finns inget nytt att importera i den här filen.
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 mt-2">
              <button
                onClick={() => setStep({ kind: "idle" })}
                className="pc-press py-4 rounded-[18px] bg-white border border-pc-line text-pc-ink font-bold text-[15px]"
              >
                Välj annan fil
              </button>
              <button
                onClick={doImport}
                disabled={!hasImportable || busy}
                className="pc-press py-4 rounded-[18px] bg-pc-orange text-white font-bold text-[15px] shadow-[0_8px_20px_-8px_rgba(255,95,0,0.6)] disabled:opacity-50"
              >
                Importera
              </button>
            </div>
          </div>
        )}

        {step.kind === "done" && (
          <div
            role="status"
            className="bg-green-50 border border-green-200 text-green-800 text-[14px] font-semibold rounded-2xl px-4 py-3 mb-3"
          >
            {step.message}
          </div>
        )}

        {/* Undo */}
        {undo && step.kind !== "parsing" && step.kind !== "preview" && (
          <div className="mt-4 border-t border-pc-line pt-4">
            {!confirmUndo ? (
              <button
                onClick={() => setConfirmUndo(true)}
                className="pc-press w-full py-3 rounded-[16px] bg-white border border-pc-line text-pc-ink font-bold text-[14px]"
              >
                Ångra senaste import
                <span className="block text-[11px] font-medium text-pc-muted">
                  {fmtWhen(undo.at)}
                  {undo.summary ? ` · ${undo.summary}` : ""}
                </span>
              </button>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                <div className="text-[13px] text-amber-900 font-semibold mb-3">
                  Det här återställer dina pass, frånvaro, utlägg, flexsaldo och bekräftade dagar
                  till hur de var före importen. Ändringar du har gjort efter importen går också
                  förlorade. Vill du fortsätta?
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setConfirmUndo(false)}
                    className="pc-press py-3 rounded-[14px] bg-white border border-pc-line text-pc-ink font-bold text-[14px]"
                  >
                    Avbryt
                  </button>
                  <button
                    onClick={doUndo}
                    className="pc-press py-3 rounded-[14px] bg-red-600 text-white font-bold text-[14px]"
                  >
                    Ja, ångra
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <button
          onClick={onClose}
          style={{
            width: "100%",
            padding: "15px",
            borderRadius: "16px",
            background: step.kind === "idle" ? "#f3ece4" : "#ff5f00",
            color: step.kind === "idle" ? "#2d1717" : "white",
            fontWeight: 700,
            fontSize: "15px",
            marginTop: "16px",
          }}
        >
          Stäng
        </button>
      </div>
    </div>
  );
}

function Line({ n, label }: { n: number; label: string }) {
  if (n === 0) return null;
  return (
    <div>
      <span className="font-extrabold tabular-nums">{n}</span> {label}
    </div>
  );
}
