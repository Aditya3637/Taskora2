// RFC-4180-ish CSV parser. Replaces a naive line.split(",") parser that
// mangled quoted fields containing commas (e.g. Indian-formatted numbers
// like "56,000 sqft"): the old code split on the first inner comma, kept
// the opening quote in the value (so the area column ended up as `"56`)
// and silently dropped the rest.
//
// Supports:
//   - quoted fields wrapped in "…", commas/newlines inside the quotes
//   - escaped quotes inside a quoted field ("She said ""hi"" today")
//   - \r\n, \n, and lone \r line endings
//   - trailing empty lines
//
// Returns a row-major array of records keyed by lower-cased header names.

export function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        // Escaped quote inside a quoted field: "" → literal "
        if (i + 1 < n && text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      // Treat \r as part of the line terminator; the matching \n (if any)
      // will be handled on the next iteration.
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }

  // Flush the last field/row if the file doesn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop trailing blank rows that contain only empty fields.
  while (rows.length && rows[rows.length - 1].every((v) => v === "")) {
    rows.pop();
  }

  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((vals) =>
    Object.fromEntries(headers.map((h, idx) => [h, (vals[idx] ?? "").trim()]))
  );
}

// Trigger a browser download for a CSV string. Shared so the buildings
// and clients pages don't re-implement it.
export function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
