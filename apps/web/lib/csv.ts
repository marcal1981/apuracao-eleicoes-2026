/** Planilha CSV no padrão brasileiro do Excel: separador ";", vírgula decimal e BOM UTF-8. */
export function csvResponse(fileName: string, rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const text = typeof v === "number" ? String(v).replace(".", ",") : (v ?? "");
    return `"${text.replace(/"/g, '""')}"`;
  };
  const body = "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "no-store",
    },
  });
}

export const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
