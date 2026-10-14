# Changelog

All notable changes to **min-tid** are recorded here. Format loosely follows [Keep a Changelog](https://keepachangelog.com).

**Versioning policy:**

- Before 1.0 we used `1.0.0-beta.N` (one bump per shipped batch).
- From 1.0.0 (stable): standard semver — `1.0.1` for bug fixes, `1.1.0` for new features, `2.0.0` for breaking changes.
- The version in `package.json` and `server/package.json` must move in lockstep. The running version is shown at the bottom of the settings modal.
- Add a section here for every bump. Never let it slip — traceability over polish.

## [Unreleased]

_Nothing yet._

## [1.0.0] — 2026-10-14

**min-tid 1.0.** Den här versionen är en genomgripande omarbetning. Det viktigaste:

- **Rättad flexberäkning och dagstatus.** Dagar utan registrering drar inte längre en hel dag, heldag flex dras en gång och lunch dras bara från ett enda långt pass. Hela historiken räknas om, så ditt saldo kan ändras.
- **Enligt schema eller Stämpla.** Rapportera genom att bekräfta schemat och bara justera det som avviker, eller stämpla in och ut som förut. Månader kan bekräftas och låsas.
- **Nya flikar:** Idag, Kalender, Rapport och Mer, med "Att åtgärda" som samlar det som väntar på dig.
- **Roterande scheman** (1–8 veckor) och schemaperioder som bevarar historiken.
- **Krypterad synk** mellan enheter: servern kan inte läsa dina data.
- **Excel:** importera din historik från en mall och exportera rapporten.
- **Semestersaldo** och **restid** med egna regler.
- **Demoläge:** öppna `?demo=1` för att titta runt med exempeldata utan att röra dina egna.

### Internt — kärnlogik utbruten (PR 1)

- Tids- och flexberäkningarna ligger nu i egna, testade moduler under `src/lib/` (`dates`, `days`, `flex`, `schedule`, `types`) i stället för inuti `PunchClock.tsx`. Ingen förändring i hur appen beter sig eller ser ut.
- Tester pinnar nuvarande beteende, inklusive fyra kända fel som dokumenteras som förväntade fel och rättas i ett senare steg.

### Krypterad synk (PR 2)

- **Synken krypteras nu på enheten.** Tider, frånvaro, utlägg, namn och schema krypteras med AES-256 innan de lämnar telefonen eller datorn. Servern lagrar bara krypterad data och kan inte läsa den — nyckeln tas fram ur din synk-kod och lämnar aldrig enheten. Synk-rutan visar en grön rad ”Krypterad på enheten · AES-256” och förklarar kort vad servern ser och inte ser.
- **Återställningsnyckel.** När du skapar ett synk-konto (eller när ett befintligt konto krypteras) får du en återställningsnyckel på 24 tecken. Den visas en gång, kan skrivas ut eller kopieras, och du bekräftar att du sparat den. SMS-återställning ger dig tillbaka kontot — men dina data låses bara upp med återställningsnyckeln. Saknar du nyckeln kan du välja att börja om med den här enhetens data.
- **Befintliga konton krypteras automatiskt** första gången du loggar in med den nya versionen. Inget försvinner: datan krypteras och den okrypterade kopian på servern raderas.
- **Byter du synk-kod** krypteras molnkopian om och du får en ny återställningsnyckel (den gamla slutar gälla). Dina andra enheter ber dig logga in igen med den nya koden innan de synkar vidare.
- **”Logga in igen”** finns direkt i felsökningsrutan när enheten behöver en ny inloggning — efter uppdateringen, när synk-koden bytts på en annan enhet eller när inloggningen gått ut. Lokala ändringar ligger kvar och slås ihop med molnet.
- **Äldre versioner av appen** får ett tydligt besked om att uppdatera i stället för att läsa eller skriva över den krypterade datan.

#### Internt

- Nytt `src/lib/crypto.ts` (Web Crypto: PBKDF2-SHA256 600 000 varv → HKDF → `authKey` + icke-exporterbar AES-GCM-nyckel, kuvert `{ v: 1, iv, ct }`, återställningsnyckel med AES-KW) och `src/lib/keyStore.ts` (nyckeln sparas i IndexedDB, aldrig i localStorage). `sync.ts` behåller sina funktionssignaturer och sköter kryptering, migrering och nyckelbyte internt.
- Servern: ny `server/core.js` med all konto- och synkpolicy (testbar utan serverberoenden), `GET /api/auth/salt`, atomiska skrivningar av `data.json`, vägrar starta på en trasig `data.json` i stället för att tömma den, och loggar aldrig request-bodies.
- Rättat: en inloggning eller ett kodbyte som pågick samtidigt som en annan enhet synkade kunde skriva tillbaka en gammal kopia av kontot.

### Roterande scheman och schemaperioder (PR 4)

- **Roterande schema.** I "Planera dagar" kan du nu välja 1–8 veckor i schemat, till exempel varannan vecka eller en fyraveckorsrotation. Varje vecka redigeras under en egen flik ("Vecka 1…N"), och "Kopiera vecka 1 till alla" fyller övriga veckor med samma tider. Raden "Den här veckan är vecka 2 av 4" visar var du befinner dig i rotationen, och du kan ange vilken vecka startdatumet ligger i.
- **Gäller från.** När du ändrar schemat anger du från vilket datum det gäller (som standard idag). Ändringen läggs till som en ny period i stället för att skriva över det gamla, så tidigare dagar behåller sin norm och flexsaldot för passerade veckor ändras inte.
- **Registrering: Enligt schema eller Stämpla.** Du kan välja hur dagarna ska registreras direkt i "Planera dagar". Valet sparas och synkas, men har ännu ingen effekt på beräkningarna.
- **Inget går förlorat.** Ditt befintliga schema flyttas automatiskt till en period som gäller från din första registrerade dag. Synk tar med alla perioder, och äldre versioner av appen hittar fortfarande ett vanligt veckoschema.

#### Internt

- `schedule.ts` har nya typer (`ScheduleRotation`, `SchedulePeriod`, `ScheduleSource`) och funktioner för perioder och rotation (`periodFor`, `toPeriods`, `appendPeriod`, `mergePeriods`, `migrateSchedules`, `weeksBetween`, `mondayOfStr` m.fl.). `getEffectiveDayConfig` behåller sin signatur men tar även en lista av perioder; ett vanligt veckoschema fungerar som förut. Veckomatematiken är datumsträngsbaserad och opåverkad av sommartid.
- "Planera dagar" ligger nu i `src/components/schedule/`. Nya tester i `src/lib/__tests__/schedule.test.ts` (varannan vecka, fyraveckorsrotation, datum före ankaret, periodbyte mitt i veckan, migrering och rundtur).

### Rätt flexberäkning, dagstatus och rapportläge (PR 3)

- **Ditt flexsaldo räknas om och siffran kan ändras.** Fyra fel i beräkningen är rättade och hela historiken räknas om med de nya reglerna, så saldot kan bli högre (oftast) eller lägre än förut:
  - **En arbetsdag utan registrering drog en hel dag.** En schemalagd dag där du varken stämplat eller lagt in frånvaro gav tidigare −8 h. Nu påverkar den inte saldot. Den räknas i stället som saknad och visas bredvid saldot, till exempel ”· 2 dagar saknas”, så att du kan fylla i den.
  - **Heldag flexledigt drogs två gånger.** En heldag flex på en 8-timmarsdag gav −16 h. Nu dras dagens norm en gång (−8 h). Flex i timmar drar just de timmarna.
  - **Lunch drogs även när du stämplat ut över lunch.** Schemats lunch dras nu bara när dagen har ett enda pass som är längre än 5 timmar. Har du stämplat ut och in under dagen räknas tiden precis som den är, och ett kort pass (5 timmar eller kortare) får ingen lunch dragen. Det gäller också historiken och veckosummorna.
  - **Pass mellan midnatt och 02:00 hamnade på fel dag.** Ett pass som börjar 00:30 räknades till dagen innan. Nu räknas alla dagar och veckor efter svensk tid. Veckorna under ”Visa veckor” och i historiken började tidigare på en söndag i rubriken – nu börjar de på måndag.
- **Har du lagt in ett startsaldo** för att väga upp de gamla felen kan du behöva justera det igen.
- **Dagar som fyllts i med ”Flera dagar” på 25 % eller 50 %** räknas nu utan lunchavdrag (passen är 5 timmar eller kortare), vilket ger upp till 1 timme mer per sådan dag.
- **Frånvaro på en ledig dag räknas inte.** Semester eller flex som sträcker sig över en helg drar bara de schemalagda dagarna. Frånvaro kan aldrig dra mer än dagens norm.
- **Rapportläget gör nu skillnad.** Med ”Stämpla” är en dag utan registrering saknad (”· N dagar saknas”). Med ”Enligt schema” räknas den som arbetad enligt schemat och visas som ej bekräftad (”· N ej bekräftade”) tills du bekräftar den. Flexsaldot påverkas inte av valet. Du som redan har stämplat behåller ”Stämpla”; nya användare börjar med ”Enligt schema”.
- **Idag blir inte rött på morgonen.** Dagens resultat räknas in i saldot när du stämplat ut, registrerat dagen eller när schemats arbetsdag är slut – aldrig innan. Framtida dagar räknas aldrig.

#### Internt

- Ny kärna: `evaluateDay(date, ctx)` i `src/lib/days.ts` ger status (`missing`, `unconfirmed`, `ongoing`, `reported`, `absent`, `partial`, `off`), norm, arbetad tid, rast, frånvaro, restid (krok för PR 8), flexdiff och en förklaring på svenska rad för rad. `computeFlex` i `flex.ts` summerar dagarna och listar saknade och ej bekräftade dagar; de gamla funktionerna finns kvar som tunna omslag. Frånvaroreglerna ligger i `absence.ts`.
- `src/lib/confirm.ts`: bekräftade dagar, låsta månader (`confirmMonth`, `unlockMonth`, `isDayLocked`) och en granskningslogg. Gränssnittet för att bekräfta och låsa kommer i ett senare steg.
- Nya, valfria fält som sparas och synkas: `reportingMode` (sparas nu alltid), `autoLunchThresholdMin` (300), `confirmedDays`, `lockedMonths`, `dayAdjustments`, `auditLog` och `breakMinutes` på pass. Äldre data laddas utan förlust.
- `todayLocal()` och `weekKey()` använder lokalt datum. De tidigare förväntat felande testerna är nu vanliga tester, plus nya fall för glömda dagar, halvdagsfrånvaro, helgarbete, helgdag, frånvaro över helg, låst månad och sommartidsnätter.

### Ny navigation och "Enligt schema" (PR 5)

- **Fyra flikar:** Idag, Kalender, Rapport och Mer. Allt som låg bakom kugghjulet, "Planera dagar" och automatiseringen finns nu under Mer.
- **Enligt schema.** Om du rapporterar enligt schema visar Idag tre stora val: **Enligt schema ✓**, **Justera dag** (start, slut, rast och anteckning) och **Frånvaro**, samt "Du kan gå kl. 17:00". Stämplar du i stället ser du klockan som förut.
- **Att åtgärda.** En ruta på Idag samlar dagar som saknas (stämpling) eller inte är bekräftade (schema), kvitton att bifoga och pass som varit öppna länge. Varje dag har snabbval: Enligt schema, Justera, Frånvaro. Har du många dagar visas de senaste fem och "Visa alla (N)". Från den 25:e kommer "Bekräfta oktober", som bekräftar och låser månaden.
- **Kalender.** Månadsvy där saknade dagar har röd ring, ej bekräftade grå ring och låsta månader ett hänglås. Tryck på en dag för att se vad som registrerats och, under "Så räknades dagen", hur tiden räknades. Det finns också en listvy.
- **Låsta månader.** Dagar i en låst månad går inte att ändra (justera, enligt schema, tider, frånvaro). Du ser ett lås och kan välja "Lås upp månaden"; upplåsningen sparas i loggen. Stämpling i realtid fungerar fortfarande.
- **Rapport.** Period, totaler, frånvaro per typ, utlägg och export. Text och CSV byggs nu per dag, så siffrorna stämmer med flexsaldot (tidigare räknades varje pass för sig).
- **Mer.** Schema & rapportläge, Frånvaroregler, Synk och säkerhet (med den gröna raden "Krypterad på enheten · AES-256"), Automatisering och Om appen.
- **Rättat:** "Flera dagar" med 25, 50 eller 75 % ger inte längre upp till en timme för mycket per dag. Nettotiden på Idag räknar lunch på samma sätt som flexsaldot. Frånvaro och utlägg föreslår rätt datum även mellan midnatt och 02:00. Användare som aldrig stämplar får nu sitt flexstartdatum när de först bekräftar eller justerar en dag. "Koppla från här" glömmer även enhetens nyckel.

#### Internt

- `PunchClock.tsx` är nu skalet (tillstånd, lagring, synk, navigation). Flikarna ligger i `src/views/`, och det som listas under "Att åtgärda", rapportraderna, flerdagsfyllningen och "du kan gå kl." är rena, testade funktioner i `src/lib/` (`attend`, `report`, `fill`, `today`, `format`).
- Platser för kommande delar finns färdiga: `ReportSlots`, `MoreSlots` och `AdjustDaySheet`s `travelSlot` (dokumenterade i CLAUDE.md).

### Excel-import och Excel-export (PR 6)

- **Importera från Excel.** Under Mer → Data finns nu "Importera från Excel". Du hämtar en färdig mall (flikarna Pass, Frånvaro, Utlägg, Restid och Saldon, med rullistor för typer), fyller i din historik och läser in filen. Före importen ser du en förhandsgranskning med antal rader och eventuella fel med flik och radnummer — rader med fel hoppas över, resten importeras. Filen läses bara i din webbläsare och skickas inte någonstans.
- **Dubbletter och exempelrader.** Ett pass med samma datum och starttid som redan finns hoppas över och räknas separat, så du kan importera samma fil igen utan att få allt dubbelt. Exempelraderna i mallen ("EXEMPEL – skriv över eller radera") hoppas över.
- **Historiken räknas som bekräftad.** Importerade dagar markeras som bekräftade, och flex räknas från den tidigaste importerade dagen om den är tidigare än din nuvarande start. Rader i en låst månad importeras inte.
- **Ingångssaldon.** Fyller du i fliken Saldon sätts ditt flexsaldo till det värdet per det datumet, och appen räknar vidare från dagen efter. Semesterdagar kvar och sparade dagar sparas som ingångsvärden för semestersaldot.
- **Ångra senaste import.** Innan importen sparas en kopia på den här enheten. "Ångra senaste import" återställer pass, frånvaro, utlägg, flexsaldo och bekräftade dagar till hur de var — ändringar du gjort efter importen går då också förlorade, och appen varnar för det först.
- **Exportera Excel.** I Rapport finns "Exportera Excel" för vald rapportperiod, med samma flikar som importmallen plus en sammanfattning (arbetad tid, flex, saldo, utlägg, dagar som saknas) och en dag-för-dag-lista som visar hur varje dag räknades. Filen kan läsas in igen i appen.
- Restider i mallen läses in och visas i förhandsgranskningen, men sparas först när restidsstödet finns.

#### Internt

- Nytt `src/lib/excel/` (parser, importplan, ångra-kopia, export, mall) och `src/components/ImportModal.tsx`. SheetJS 0.20.3 ligger som `vendor/xlsx-0.20.3.tgz` (inte npm-paketet `xlsx`) och laddas först när du importerar eller exporterar, så startbunten växer knappt.
- Nytt `AppState.flexBaseDate`: `flexBaseMinutes` gäller i slutet av det datumet och `evaluateDay` ger flex 0 för det datumet och tidigare dagar, så flexkortet, rapporten och kalendern alltid är överens. Fältet följer med i sparande och synk, liksom `vacation` (ingångssaldo för semester).

### Semestersaldo (PR 7)

- **”Semester: 17 av 25 dagar kvar”.** Ett nytt kort visar hur många semesterdagar du har kvar under semesteråret (som standard 1 april – 31 mars, 25 dagar). Sparade dagar visas separat (”+ 5 sparade”).
- **Rätt dagar dras.** En semesterperiod drar en dag för varje dag du enligt schemat skulle ha arbetat. Helger, röda dagar (helgdag) och lediga dagar i ett roterande schema drar ingenting.
- **Halva dagar.** Slå på ”Tillåt halva semesterdagar” om du tar semester på deltid; annars räknas en semesterdag med färre timmar ändå som en hel dag (det står i kortet).
- **Planerad semester räknas.** Semester längre fram dras direkt från saldot, och kortet varnar om du planerat mer än du har.
- **Ingående saldo.** Under ”Ändra” kan du ange dagar kvar och sparade dagar per ett visst datum; bara semester efter det datumet dras därefter.
- Inställningarna följer med i synken och äldre data läses in oförändrat.

### Restid (PR 8)

- **Restid som egen post.** En resa har från- och tilltid (i femminutersteg), valfri destination och anteckning. Resor kan korsa midnatt. Du lägger till, ändrar och tar bort restid i ”Justera dag”. Restiden sparas direkt, även om du inte sparar justeringen.
- **Restidsregler.** Restid inom schemalagd arbetstid räknas alltid som arbetad tid. För restid utanför arbetstid väljer du: till lön (standard), till flex eller räknas inte. Du kan också ange en faktor (till exempel 0,5), en maxgräns per dag och att natten (22:00–06:00) inte ska räknas. Reglerna hittar du under Mer → Restidsregler.
- **Resetimmar flyttas.** Utlägg av typen Resetimmar finns inte längre att välja. Gamla resetimmar flyttas automatiskt till restid, märkta ”importerad”, med din anteckning kvar. Eftersom de saknar klockslag räknas de som restid utanför arbetstid. Ett gammalt utlägg vars belopp inte kan vara timmar (till exempel 350) lämnas orört som utlägg – inget försvinner.
- Restid sparas och synkas mellan enheterna.
- **Restid i flexsaldot.** Restid utanför schemat som du lagt på flex ökar saldot den dagen (inte för framtida dagar, dagar före flexstart eller dagen som pågår). Restid inom schemat ingår redan i arbetstiden och läggs inte på igen, och restid till lön påverkar aldrig flex. Dagens förklaring visar vart restiden tog vägen.
- **Excel.** Importen läser nu Restid-bladet: resorna visas i förhandsgranskningen (”N restider”), läggs till med från/till, resmål och kommentar, och finns med när du ångrar importen. En resa som redan finns (samma datum och från) hoppas över. Excel-exporten får ett eget blad ”Restid” (datum, från, till, resmål, inom schema, utanför, till lön, till flex, kommentar) och timmar till lön i sammanfattningen. Resor över midnatt och importerade resor utan klockslag skrivs ut, men kan inte läsas in igen.
- **Rapport.** Rapporten har en rad ”Restid” med totalt, inom schemat, utanför schemat och timmar till lön separat. CSV har kolumnerna ”Restid (min)” och ”Restid till lön (min)”, och delningstexten får en restidsrad.

#### Internt

- Ny `src/lib/travel.ts` (`splitTravel`, `splitTravelDay`, `makeTravelFor`, `migrateTravelState`) med tester. `evaluateDay` får restiden genom `travelFor`-kroken; `days.ts` lägger `travel.flexMin` på `flexDelta` för dagar som räknas och förklarar restiden i `explanation`. `DayEvaluation.travel` har nu även `payrollMin` och `flexMin`.

### Demoläge och 1.0 (PR 9)

- **Demoläge.** Lägg till `?demo=1` i adressen så öppnas appen med exempeldata för "Anna Demo": åtta veckor i Enligt schema, ett tvåveckorsschema, en semestervecka, en VAB-dag, två dagar att bekräfta, en resa utanför schemat, några utlägg och en bekräftad och låst månad. Ett fält högst upp säger "Demoläge – inget sparas" med en knapp för att avsluta. Allt du ändrar i demon försvinner när du laddar om eller avslutar.
- **Dina egna data rörs aldrig i demon.** Demon läser och skriver inte dina vanliga data, pratar aldrig med servern och synken är avstängd ("Synk och säkerhet" förklarar det). Importen är avstängd. "Avsluta demo" tar dig tillbaka till din egen app precis som du lämnade den.
- **Välkomstskärmen** har en länk "Titta runt i en demo först".
- **Tydligare första start.** Schemavalet i introduktionen pekar på rätt plats (Mer → Schema & rapportläge). Kalendern visar inte längre dagar före din första registrering som "Ledig · 8 h".
- **Rapporten räknar inte dagar före flexstart.** Börjar du mitt i en månad visar Rapport bara dagarna från din första registrering, inte hela månaden som arbetad enligt schema.

#### Internt

- Ny `src/lib/demo.ts`: `buildDemoState(today)` är ren och deterministisk och bygger allt relativt dagens datum, så demon blir aldrig inaktuell. `storageKeyFor`, `shouldSync` och `exitDemoUrl` är små hjälpare med tester som visar att demon använder `punchclock_demo` och att synklagret aldrig anropas.
- Version 1.0.0 i `package.json` och `server/package.json`. README och CLAUDE.md är uppdaterade.

## [1.0.0-beta.12] — 2026-08-26

### Added

- **Röd banner när synken inte fungerar.** Ett jobbnätverk kan släppa fram appen men blockera synken (403 från en proxy) — appen fortsatte då tyst att spara lokalt utan att någon märkte att timmarna aldrig lämnade telefonen. Nu visas en röd varning direkt under rubriken, på alla flikar, så länge synken felar. Den går att dölja, men kommer tillbaka vid nästa fel, och försvinner av sig själv så fort synken fungerar igen.
- **”Läs mer och åtgärda”** öppnar inställningarna med en felsökningsruta som förklarar vad som hände (”Nätverket blockerar synken”, felkod, tidpunkt), varför det oftast händer, och en numrerad åtgärdslista — byt till mobildata, stäng av VPN, försök igen. Rutan säger också rakt ut att inget är förlorat: allt ligger kvar på enheten och laddas upp när nätet fungerar.
- **”Skicka fellogg”** mejlar en färdig felanmälan till christian@krut.it med ämnet `mintid sync error kl HH:MM` och en logg med app-version, tidpunkt, användarnamn, felkod, nätverksstatus, senaste lyckade synk och enhet — plus de senaste felen. Synk-koden och inloggnings-token följer aldrig med.
- **”Försök igen”** direkt i felsökningsrutan.

### Internal

- `SyncApiError` i `sync.ts` bär `status` / `path` / `method`; `status === 0` betyder att förfrågan aldrig fick svar (offline, blockerad, captive portal).
- Nytt `src/lib/syncDiagnostics.ts`: `explainSyncError()` (felkod → rubrik, orsak och åtgärder på svenska), rullande logg med de 10 senaste felen i `localStorage["sync_error_log"]` (aldrig synkad), och `buildSyncReportMailto()`.
- `PunchClock`: `noteSyncFailure()` / `clearSyncFailure()` som enda väg in och ut ur feltillståndet, ny `SyncErrorBanner`-komponent mellan header och main (båda `shrink-0`, så bannern följer med på alla flikar).
- `SettingsModal` tar `syncFailure`, `syncErrorLog`, `openSyncHelp` och `dirty` i stället för den tidigare `syncError`-strängen.

### Docs

- `CLAUDE.md`: nytt avsnitt om hur synkfel ytas, samt ett planeringsavsnitt om den framtida admin- och schemaläggningsappen (separat privat repo — inget av det byggs här).

## [1.0.0-beta.11] — 2026-08-26

### Fixed

- **Synk är nu tvåvägs.** Appen hämtade aldrig data från servern efter första återställningen — den bara skickade. Enheten du öppnade sist skrev tyst över den andra enhetens dag. Nu hämtas molnkopian när appen öppnas, när den tas fram i förgrunden igen och när nätet kommer tillbaka.
- **"Återställ" hämtar på riktigt.** Om kontot fanns men inte hade någon sparad data visade appen "klart" och lämnade kvar den lokala datan utan att säga något. Nu byts data ut när det finns något att hämta, och när molnet är tomt får du en tydlig förklaring i stället för en falsk bekräftelse.
- **"Koppla från" raderade hela synk-kontot** på servern (och därmed molnkopian för alla enheter). Nu finns två separata val i inställningarna: _Koppla från här_ (stänger av synk lokalt, kontot ligger kvar) och _Radera synk-konto_ (destruktivt, kräver en extra tryckning).
- **Ingen data försvinner när båda enheterna ändrat.** Har den här enheten ändringar som inte nått servern samtidigt som en annan enhet skrivit, slås posterna ihop per `id` i stället för att den ena sidan skriver över den andra. Är enheten ren adopteras molnkopian rakt av, så borttagningar på den andra enheten slår igenom.
- **Ingen uppladdning innan appen läst servern.** En enhet som legat oöppnad kunde tidigare skicka upp sin gamla data 3 sekunder efter att den öppnades. Push sker nu först efter en lyckad hämtning; ändringar gjorda offline märks som osparade och går upp när nätet är tillbaka.
- Lokal data läses in synkront vid start i stället för i en effekt — spar-effekten hann annars köra en gång med tomma standardvärden.

### Added

- **"Hämta nu"-knapp** i synk-kortet i inställningarna, för när du precis stämplat på en annan enhet och inte vill vänta. Statuskortet visar också "Hämtar från molnet…" och felmeddelandet vid synkfel.

### Internal

- Server: `stateUpdatedAt` per användare som revisionsmarkör. `GET /api/sync` returnerar `{ state, updatedAt }`, `PUT /api/sync` returnerar `{ ok, updatedAt }`, och `login` / `recover/confirm` returnerar `updatedAt` tillsammans med state.
- `sync.ts`: `syncPull` returnerar `{ state, updatedAt }`, `syncPush` returnerar den nya revisionen; nya nycklar `SYNC_REV_KEY` (`sync_rev`) och `SYNC_DIRTY_KEY` (`sync_dirty`).
- `PunchClock.tsx`: ny synkmotor — `pullNow` / `pushNow` / `pushSoon` / `applyRemoteState` / `adoptRestoredState` med `syncRevRef`, `dirtyRef`, `hydratedRef`, `suppressPushRef` och `stateRef`; `mergeSyncState()` + `mergeById()` på modulnivå; `pagehide` flushar väntande push.
- `SettingsModal` tar `syncError`, `onPullNow` och `onDeleteSyncAccount`; `syncStatus` har ett nytt läge `"pulling"`.

## [1.0.0-beta.10] — 2026-06-24

### Added

- **Username shown clearly in settings.** When sync is active the settings modal now shows "Inloggad som: @username" under the sync status — no more wondering which account you're on.
- **Change PIN without disconnecting.** A new "Byt synk-kod" section in settings (visible when synced) lets you set a new secret in-place. The server re-hashes and saves it; the existing JWT stays valid and sync continues uninterrupted.
- **SMS recovery via 46elks.** Attach a mobile number to your account at any time:
  - In **settings** (when synced): "Återhämtningsnummer" card — enter number → receive 6-digit SMS code → verify → phone saved.
  - In **onboarding** (new user flow, after account creation): optional "Lägg till återhämtningsnummer" step with the same OTP flow; can be skipped.
- **Phone-based account recovery.** In the sync modal ("Återställ" tab), a new "Återhämta med mobilnummer" link opens a recovery flow: enter registered phone → receive SMS code → confirm → logged in and data restored. Works both during onboarding and when adding sync to an existing device.

### Internal

- Server: new in-memory OTP store with SHA-256 hashing, 10-min TTL, per-phone rate limiting (configurable via `SMS_RESEND_COOLDOWN_SEC`, `SMS_MAX_PER_HOUR`, `SMS_MAX_PER_DAY`). 46elks credentials: `ELKS_API_USERNAME`, `ELKS_API_PASSWORD`, `ELKS_FROM`.
- Server: 5 new routes — `PUT /api/auth/secret`, `POST /api/auth/phone`, `POST /api/auth/phone/verify`, `POST /api/auth/recover/request`, `POST /api/auth/recover/confirm`.
- `sync.ts`: `SYNC_USERNAME_KEY`, `SYNC_PHONE_KEY` constants; `syncChangeSecret`, `syncSendPhoneCode`, `syncVerifyPhone`, `syncRecoverRequest`, `syncRecoverConfirm` functions.
- `OnboardingResult` type gains `syncUsername`; callback chains updated to thread username through all sync paths (register, restore, login).

## [1.0.0-beta.9] — 2026-06-24

### Added

- **Long-session reassurance on the clock.** When an active session passes the late-punchout threshold (forgotten check-out territory — a timer reading "29h 0min"), an amber card now appears under the punch button: _"Långt pass (29h 0min). Glömde du checka ut? Bekräftelse sker innan utcheckning."_ with a **Välj sluttid** button that opens the end-time chooser directly. Removes the fear that tapping "Checka ut" silently records the full inflated duration.
- **"Stämpla ut enligt schema" one-tap option.** The late-punchout sheet now offers a recommended button that checks out at the _scheduled_ end time of the day the session started (e.g. kl. 17:00), showing the resulting pass length. This is the practical "automatic checkout" for forgotten punch-outs — one tap credits a normal scheduled day instead of an all-night session. The custom time picker also defaults to that scheduled end.
- **"+X över schemat" statement.** Once today's net target is reached during an active session, the leave-time line appends how far over the schedule you are (e.g. _"Mål uppnått — du kan gå hem · +1h 30min över schemat"_).

### Internal

- `LatePunchoutModal` gained an optional `scheduledEndMs` prop; `PunchClock` derives it from the active session's start-day effective schedule and passes it through.
- New derived state in `PunchClock`: `isLongSession`, `overScheduleMin`, `lateScheduledEndMs`.

## [1.0.0-beta.8] — 2026-06-23

### Added

- **Helgdag (röd dag) absence category.** A new "Helgdag" entry in the absence modal (🏖️) covers Swedish public holidays when no work is done. Like other non-flex absences it excuses the day — the daily norm drops to 0 and flex is unaffected. Entry flow: Historik → Kalender → tap the holiday date → `+ Avvikelse` → Helgdag.
- **Förkortad arbetsdag — schedule exception per date.** When the company has everyone leave early (e.g. Thursday ends at 13:00 instead of 17:00), a small gear ⚙️ button on each history day row opens "Ändra schema för dag". Set a new end time and optional lunch minutes; the effective norm for that date is recalculated accordingly so the user gets 0 flex rather than hours of unearned minus. The same button appears in the calendar detail card. Exceptions are stored as `scheduleExceptions: Record<YYYY-MM-DD, ScheduleException>` in localStorage, included in sync, and auto-removed via "Återställ normalt schema".
- Exception badge shown inline under the date label in each history row when an override is active.

### Changed

- All flex computation functions (`computeFlexMinutes`, `computeTodayContribution`, `computeTodayDelta`, `computeWeekNet`, `buildShareText`, `buildCsvExport`) now resolve the **effective** `DayConfig` via the new `getEffectiveDayConfig(dateStr, schedule, exceptions)` helper before calculating norms and actuals. Today's leave-time predictor, schedule nudge banners, and late punch-out threshold also use the effective config, so a shortened day shows the correct leave time.

### Internal

- New `ScheduleException = { type: "override"; endTime; lunchMinutes?; note? }` type in `PunchClock.tsx`.
- `getEffectiveDayConfig()` module-level helper merges a date's exception (if any) into the base weekly `DayConfig`.
- `computeDayMinutes` and `computeWeekNet` accept an optional `exceptions` parameter; all call sites inside the flex and report flows pass it through.
- `CalendarView` now receives `scheduleExceptions` and uses it for dot-color accuracy.
- `SyncState` gains an optional `scheduleExceptions` field so overrides sync between devices.

## [1.0.0-beta.7] — 2026-06-12

### Added

- **Stämpling utan att öppna appen (URL-actions).** The app now accepts `/?action=in|out|toggle&source=qr|nfc|wifi|shortcut|link`. Any trigger that can open a URL punches the clock: printed QR codes, NFC tags, iOS Shortcuts WiFi automations ("when I connect to the office WiFi → check in"), and home-screen shortcuts. The action is consumed and stripped from the address bar on load (a reload never re-punches), and execution is schedule-aware:
  - Duplicate triggers within 2 minutes are swallowed (WiFi flapping, double-scanned QR codes).
  - An automatic check-in on a day the schedule marks as free asks for confirmation instead of silently punching in.
  - Auto check-out goes through the same short-session and late-punchout guards as the button.
  - Sessions remember their trigger (`source`) and show a small badge (📷 / 🏷️ / 📶 / ⚡) in the day's session list.
- **"Automatisera in/ut-checkning"** — new bottom sheet, opened from Inställningar (kugghjulet), with: QR codes for in/ut/växla (printable office signs via "Skriv ut skyltar"), step-by-step iOS Shortcuts recipes for WiFi- and NFC-triggered punching with copy-ready links, and install-to-home-screen instructions.
- **PWA support.** Web app manifest (standalone display, app shortcuts for "Checka in"/"Checka ut"), SVG + apple-touch icons, and a network-first service worker so the app loads offline. Installed on an iPhone home screen it behaves like a native app.
- **Schedule nudges (Visma/Fortnox-style).** On the clock view: once the scheduled start has passed without a punch — "Enligt schemat började du 08:00. Checka in?" with a one-tap backdated "Från 08:00" option; once the scheduled end has passed while still checked in — "Dags att checka ut?". Dismissible per day.
- **Schedule line in the "Idag" card** — shows today's scheduled window and lunch (`Schema 08:00–17:00 · 60 min lunch`) or "Ledig dag enligt schema".
- Toast feedback for all automated punches ("📶 Incheckad 08:02 via WiFi").
- `docs/ios-automation.md` — how the URL-action architecture works, the office setup guide, and the roadmap for a native iOS wrapper (Capacitor) for push notifications, Live Activities and Siri.

### Changed

- **Horizontal swipe pickers replaced** — the sideways-scrolling month pills in "Skapa rapport" and "Utlägg" worked poorly on desktop. New `MonthPicker`: two pills for the current and previous month (labelled with the month names) plus **"Annan…"**, which reveals a native dropdown with the last 24 months (native on both phone and desktop, and reaches further back than the old 6-pill row). The history filter pills ("Den här veckan" etc.) became a 2×2 grid instead of a scroll row.

### Internal

- New `src/lib/actions.ts` (action parsing/URLs/dedupe), `src/components/AutomationModal.tsx`, `public/` (manifest, icons, service worker), `scripts/gen-icons.mjs` (dependency-free PNG icon generator). New dependency: `uqr` (pure-JS QR rendering).

## [1.0.0-beta.6] — 2026-06-01

### Fixed

- **Calendar showed every day one slot off.** Each grid cell derived its date key with `toISOString()` on a _local-midnight_ `Date`, which in a positive-UTC-offset timezone (Sweden is UTC+1/+2) rolls back to the previous day. So tapping "1 Maj" opened "30 April", and the day-dots/hours appeared shifted — which also read as "the week starts on Sunday" even though the header and grid offset were already Monday-first. Cells now use a local `ymdLocal()` formatter, so the displayed number, the selected-day detail, the data dots, and the today/past highlighting all line up.

### Changed

- **"Dela" is now a report builder.** Instead of auto-generating a fixed last-8-weeks text, the tab opens a **"Skapa rapport"** flow:
  - Pick a **period**: a month (last-6-months pills) or a custom **datumintervall** (Från/Till).
  - **Skapa rapport** then produces the text report _for that exact period_ and reveals the share/export actions.
  - **Kopiera text / Dela text** for the plain-text version, plus **Ladda ner CSV** and **Dela fil** (shares the CSV via the native share sheet where supported, falls back to download).
  - The receipt-to-attach reminder is now scoped to the selected period.
- `buildShareText` and `buildCsvExport` take an explicit `[start, end]` range instead of "last 8 weeks" / `(year, month)`; the text report carries a `📅 <period>` header line.

## [1.0.0-beta.5] — 2026-05-29

### Added

- **Multi-day percentage entry in "Lägg till tid".** The add-time sheet now has an "En dag / Flera dagar" toggle (single-day stays the default). In "Flera dagar" mode a **Från/Till** range picker appears plus **100 % / 75 % / 50 % / 25 %** presets — the same percentage idea already in "Avvikelse". Saving creates one session per scheduled day in the range, each worth that percentage of _that day's_ scheduled net.
  - Covers the two real cases: VAB 50 % shared with a partner while still working 50 % (→ log 50 % of the workday), and "forgot to punch a whole week, nothing changed" (→ 100 % for every day that week).
  - **Inactive/weekend days are skipped** (no schedule = nothing added), and **days that already have a session are skipped** so re-running can't double-count. A live preview shows how many days will be filled, the total time, and how many were skipped (lediga / redan registrerade).
  - Each generated session respects the lunch convention: raw length = `pct% of net + lunchMinutes`, so the resulting net matches the chosen percentage. A 100 % day reproduces the exact scheduled shift.
  - Range capped at ~4 months as a fat-finger guard.

### Internal

- `SessionModal` gained `existingSessions` and `onSaveMany` props. New module-level `ymdLocal()` helper formats local `YYYY-MM-DD` to avoid the UTC date-shift `toISOString` can cause near midnight (also now used for the edit-session initial date).

## [1.0.0-beta.4] — 2026-05-27

### Added

- **Lunch convention surfaced in the UI.** The schedule editor (both onboarding and "Planera dagar") now opens with a small info card: 🍽️ Lunch räknas av automatiskt — stämpla inte ut för lunch, minuterna nedan dras från din punchade tid. Removes a hidden assumption that bit users by tying lunch deduction to a number they couldn't see acting.
- **Lunch reminder under the leave-time predictor.** When today's schedule has `lunchMinutes > 0` and a session is active, a faint line below "Du kan gå hem kl. HH:MM" reads `🍽️ Inkl. NN min lunch (räknas av automatiskt)` so users see exactly why the predicted leave time is later than `start + target`.

## [1.0.0-beta.3] — 2026-05-27

### Fixed

- **Leave-time predictor was telling users to leave too early.** The line assumed sessions were pure work (lunch punched out), but the flex calc auto-deducts `lunchMinutes` from raw punched time. So a user with an 8 h target + 1 h lunch who punched in continuously was told to leave at 8 h raw — and got penalised −1 h flex when net came out to 7 h. The predictor now uses `target + lunch` raw minutes (matching `computeDayMinutes.net`) so the predicted leave-time, the "Mål uppnått" banner, and the flex contribution all agree.
- **Late punch-out modal was firing on normal workdays.** The 4 h threshold triggered the "långt pass — välj sluttid" sheet at 8 h 09 min on a regular 8 h day. Threshold is now schedule-aware: `max(10 h, scheduled shift duration + 4 h)`. A standard 8-17 shift won't trigger it until ~13 h punched in; a 6 h shift not until 10 h. Real forgotten-punch-out cases (overnight, 12+ h) still fire.
- The "Sätt annan sluttid" picker in `LatePunchoutModal` defaults to `sessionStart + (target + lunch)` to match the predictor, so confirming the default credits a full day's net.

### Internal

- `shiftMinutes` is now imported from `schedule.ts`. `LONG_SESSION_THRESHOLD_MS` constant replaced by the `lateThresholdMs(todayCfg)` helper.

## [1.0.0-beta.2] — 2026-05-27

### Added

- **Per-day "Avvikelse" button** in the calendar day card and per-day rows of the history list — alongside the existing "Tid" button, so you can register absence on any day directly from history. `AbsenceModal` now accepts `initialDate` and `schedule` props.
- **Percentage presets** (100% / 75% / 50% / 25%) in `AbsenceModal` when "Ange timmar" is active. Each preset fills the manual-hours field with that fraction of the start day's scheduled net hours (or 8 h fallback). Snapped to 0.5 h. Numeric input still editable.
- **Optional `amount` on `ExpenseEntry`** — milersättning entries can be saved with only km, no SEK amount required. The label gets a "(valfri — räcker med km)" hint when milersättning is selected.
- **Flex section on home view** — replaces the small flex line in the today card. Shows total flex plus an "Idag · Veckan · Månaden" 3-stat row and opens a bottom sheet with the last 12 weeks broken down individually.
- **`trackingStartDate`** in root state — flex accrues from this day forward. Set automatically on first punch; existing users get it backfilled from their earliest session so historic flex stays consistent.
- **Leave-time predictor** — when an active session is running on an active workday, the clock view shows "Du kan gå hem kl. HH:MM" (or "Mål uppnått — du kan gå hem" once today's net target is reached). Sessions are treated as pure work time — lunch is not auto-added.
- **Late punch-out modal** — punching out after a 4+ hour session opens a bottom sheet offering "Stämpla ut nu", a custom end-time picker (defaults to start + today's net target), or cancel. Saving with end ≤ start or end > now is disabled with inline validation.
- New components: `FlexBreakdownModal.tsx`, `LatePunchoutModal.tsx`.

### Changed

- **`computeFlexMinutes`** rewritten for day-by-day accrual from `trackingStartDate`. Every scheduled workday strictly **before today** contributes `actual − scheduled net`; non-flex absences (VAB, semester, etc.) reduce that day's norm but don't drain the bank; flex-leave absences still deduct from the bank.
- **Today rolls in when you punch out — not the next morning.** New `computeTodayContribution` adds today's `actual − target` to the total flex (and the week/month sub-stats + the current-week row in the breakdown) the moment the day is "settled" (no active session AND at least one completed session today). During an active session today contributes 0 — no red −8 h in the morning.
- **Live "Idag" sub-stat** = `worked today − today's target`. Green if ≥ 0, red if < 0. Independent of whether the contribution has rolled into total yet.
- **Active sessions never count toward total flex.** Only completed sessions feed the bank; the "Idag" sub-stat is the in-progress signal.
- **Expense displays** (list, share text, receipt reminder, month total) handle missing amounts gracefully — km and amount are shown only if present, joined by " · ", with the total summing `e.amount ?? 0`.
- The single "Lägg till tid" action per day in history split into two compact buttons ("+ Tid" / "+ Avvikelse").
- Sync `SyncState` includes `trackingStartDate`; it round-trips with login/restore and the debounced push.

### Skipped (intentionally)

- Push notifications for long sessions — reliable background firing on iOS PWAs requires Service Worker + Web Push + backend infra. The late punch-out modal is the durable safety net instead.

## [1.0.0-beta.1] — 2026-05-26

First public beta. The app is feature-complete for time, absence and expense tracking; the optional sync backend is self-hostable; the deployment story is settled.

### Added

- **Onboarding** — welcome screen splits flow into "Ny användare" (full setup) vs "Återkommande användare" (one-screen username + secret login that pulls all state from sync).
- **Sync** — multi-device sync via a self-hostable Express backend. Users register with `username + secret`; the server stores only a bcrypt hash + JWT-issued tokens. No e-mail, no personal data.
- **Expense tracking** — new "Utlägg" tab with categories (milersättning, traktamente, resetimmar, parkering, kost, representation, övrigt). Milersättning entries include a `km` field; receipts can be flagged for later attachment. Expenses are included in the shared time report with a receipt-reminder card.
- **Flex bank** — automatic computation of flex balance from past sessions vs scheduled norm; flex-leave absences deduct from the bank. `flexBaseMinutes` lets users set a one-time correction on first sync.
- **CSV export** — month-by-month export including absences and notes, BOM-prefixed for Excel UTF-8 detection.
- **History calendar view** — toggleable list/calendar mode on the History page.
- **Server cleanup** — sync accounts inactive for 60+ days are auto-deleted on server startup and every 24 h.
- **App version display** — `__APP_VERSION__` from `package.json` is rendered at the bottom of the settings modal.

### Changed

- **Mobile layout** — bottom nav is no longer `fixed bottom-0`; the outer container is `fixed inset-0` with `<main>` scrolling internally. This stops the nav from drifting when mobile Safari shows/hides the URL bar.
- **Sync UI location** — moved from the clock view to the settings (gear) modal.
- **Sync identity** — registration now requires a unique username (3–20 chars, `a–z 0–9 _ -`, case-insensitive) paired with the secret. The earlier secret-only `HMAC` lookup is gone.
- **Settings modal** — also surfaces sync state (active / activate / disconnect) and the running app version.
- **Storage shape** — `expenses: ExpenseEntry[]` added to `punchclock_v2`; `ExpenseEntry` gained an optional `km?: number` field for milersättning.
- **24-hour time format** throughout the UI.
- **Fork-plate-knife icon** for kost/lunch instead of the coffee cup.

### Fixed

- Flex balance no longer excludes today's entries.
- Lunch deduction during ongoing sessions used the wrong base — fixed.
- `AbsenceModal` state reset on re-open.
- Settings modal stale-state bug (`useEffect([open])` sync from props).
- Duplicate schedule editor when reopening "Planera dagar".
- "Friskvard" typo → "Friskvård".

### Infrastructure

- **Dockerfile** uses `node:22-slim` (Debian) — Alpine was abandoned because `npm ci` was fragile around native modules; the server is now pure JS so this is no longer load-bearing, but the slimmer image is still useful.
- **`docker-compose.yml`** uses `expose: 3000` (no host port binding) so Coolify's reverse proxy can route to it. A host bind mount `./data:/app/data` keeps `data.json` directly inspectable on the host. `data/` is gitignored.
- **`server/package-lock.json`** is now committed — without it `npm ci` in Docker/Nixpacks fails with `EUSAGE`.
- **`nixpacks.toml`** overrides the default Caddy start command if Coolify falls back to Nixpacks instead of Dockerfile.
- **Zero native deps** on the server — `better-sqlite3` was replaced with a plain JSON file store.

[Unreleased]: https://github.com/jensenjr/min-tid/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/jensenjr/min-tid/releases/tag/v1.0.0
[1.0.0-beta.12]: https://github.com/jensenjr/min-tid/releases/tag/v1.0.0-beta.12
[1.0.0-beta.11]: https://github.com/jensenjr/min-tid/releases/tag/v1.0.0-beta.11
[1.0.0-beta.10]: https://github.com/jensenjr/min-tid/releases/tag/v1.0.0-beta.10
[1.0.0-beta.9]: https://github.com/jensenjr/min-tid/releases/tag/v1.0.0-beta.9
[1.0.0-beta.8]: https://github.com/jensenjr/min-tid/releases/tag/v1.0.0-beta.8
[1.0.0-beta.1]: https://github.com/jensenjr/min-tid/releases/tag/v1.0.0-beta.1
[1.0.0-beta.2]: https://github.com/jensenjr/min-tid/releases/tag/v1.0.0-beta.2
[1.0.0-beta.3]: https://github.com/jensenjr/min-tid/releases/tag/v1.0.0-beta.3
[1.0.0-beta.4]: https://github.com/jensenjr/min-tid/releases/tag/v1.0.0-beta.4
[1.0.0-beta.5]: https://github.com/jensenjr/min-tid/releases/tag/v1.0.0-beta.5
[1.0.0-beta.6]: https://github.com/jensenjr/min-tid/releases/tag/v1.0.0-beta.6
[1.0.0-beta.7]: https://github.com/jensenjr/min-tid/releases/tag/v1.0.0-beta.7
