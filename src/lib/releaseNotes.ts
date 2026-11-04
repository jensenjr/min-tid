/**
 * "Nytt i versionen" in Mer → Om appen: 1–3 short lines per release, newest
 * first, from 1.0.0 on. The full history is CHANGELOG.md (CHANGELOG_URL).
 *
 * Every bump adds an entry here next to its CHANGELOG section; a test checks
 * that package.json's version is the first entry and that every stable
 * CHANGELOG version from 1.0.0 has one, with the same date.
 */
export type ReleaseNote = { version: string; date: string; notes: string[] };

/** The default branch, which is deployed (see CLAUDE.md → Deployment). */
export const CHANGELOG_URL = "https://github.com/jensenjr/min-tid/blob/main/CHANGELOG.md";

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "1.3.0",
    date: "2026-11-04",
    notes: [
      "Välj om du är Stämplare eller Justerare, i onboardingen och under Mer → Hur du rapporterar.",
      "Startsidan anpassar sig: en stor in/ut-knapp eller en stor Enligt schema-knapp, med den andra som mindre knapp.",
    ],
  },
  {
    version: "1.2.1",
    date: "2026-11-02",
    notes: [
      "Säkrare: typsnittet hämtas inte längre från Google och inloggningen spärras efter upprepade felförsök.",
      "Servern skickar säkerhetsheaders och körs inte som administratör.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-11-02",
    notes: [
      "Välj flera dagar i kalendern och sätt OK, sjuk, VAB, semester eller flex på alla på en gång.",
      "Månaden låses först när alla dagar är genomgångna. Flexsaldot kan justeras manuellt.",
      "Ljust/mörkt-knapp i sidhuvudet och en kalender som fyller skärmen på datorn.",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-11-02",
    notes: [
      "Mörkt läge som följer enheten, och fem färgteman under Mer → Utseende.",
      "Bättre på datorn: sidomeny, bredare innehåll och dialogrutor i stället för blad.",
      "Om appen visar nu vad som är nytt i varje version.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-10-14",
    notes: [
      "Omarbetad app: flikarna Idag, Kalender, Rapport och Mer, och rapportering Enligt schema eller med stämpling.",
      "Rättad flexberäkning, roterande scheman, semestersaldo och restid.",
      "Krypterad synk mellan enheter, Excel-import och -export, och ett demoläge.",
    ],
  },
];

/** "2 nov. 2026" */
export function fmtReleaseDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("sv-SE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
