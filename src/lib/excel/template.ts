// The import template: Instruktioner, Pass, Frånvaro, Utlägg, Restid, Saldon and the hidden
// Listor sheet (Mallversion 1), with orange input cells, drop-downs and validations.
//
// SheetJS Community can't write data validations, cell styles or comments, so the file in
// docs/min-tid-importmall.xlsx is embedded as-is (templateData.ts, a lazy chunk) instead of
// being rebuilt sheet by sheet. A test compares the embedded bytes with the docs copy.
export const TEMPLATE_FILENAME = "min-tid-importmall.xlsx";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function buildTemplate(): Promise<Uint8Array> {
  const { TEMPLATE_BASE64 } = await import("./templateData");
  const bin = atob(TEMPLATE_BASE64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
