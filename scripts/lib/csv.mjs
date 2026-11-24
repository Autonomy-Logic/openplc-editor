// csv.mjs — RFC-4180 CSV reader that tokenizes the WHOLE document.
//
// Why this exists: the previous parser did `text.split('\n').map(parseCsvLine)`.
// Splitting on newlines BEFORE parsing quotes means a quoted field containing a
// newline (an advisory `summary` from OSV/GHSA, i.e. third-party text) is torn
// into two "rows", every column after it shifts, and the row count is wrong. In
// gen-osv-ignores that misalignment lands a verdict in the id column and an id in
// the verdict column — so an advisory triaged `affected` can end up suppressed
// while the `not_affected` one keeps alerting. A quote-aware scan over the full
// text cannot desynchronize that way.
//
// scan-vulns.mjs now also collapses newlines when writing, so this is
// defense-in-depth: either layer alone prevents the misalignment.

export function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  const src = String(text).replace(/\r\n?/g, '\n'); // normalize CRLF (Windows checkouts)
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
      continue;
    }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  // Trailing field/row: only emit if there is actually something there, so a
  // file ending in a newline does not produce a phantom [''] row.
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
