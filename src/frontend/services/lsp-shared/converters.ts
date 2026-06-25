// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Type conversions between Monaco and LSP.
 *
 * Kept as pure functions in their own module so we can unit-test
 * them without touching a worker.  The conversions handle the three
 * coordinate quirks that show up everywhere:
 *
 *   - Monaco lines and columns are 1-indexed; LSP rows and columns
 *     are 0-indexed.
 *   - Monaco's `IRange` uses `start{Line,Column}` + `end{Line,Column}`;
 *     LSP's `Range` uses `{start,end}.{line,character}`.
 *   - Monaco's `CompletionItemKind` is its own enum; LSP's is the
 *     standard `CompletionItemKind`.  Identical ordering for the
 *     subset language services typically surface, so a direct cast
 *     suffices.
 *
 * All converters are total — invalid inputs surface as a defaulted
 * sentinel rather than a thrown error, so a single malformed LSP
 * response can't crash the renderer.
 *
 * Every converter accepts an optional `lineOffset` to account for a
 * preamble the language service prepends before handing the doc to
 * its worker (ST's declaration + VAR blocks; Python's synthetic
 * `input`/`output` globals).  Monaco's body-only view starts at
 * line 0; the worker sees the same body at line `lineOffset`.
 * Outbound (Monaco → LSP) adds the offset; inbound (LSP → Monaco)
 * subtracts it.  Defaults to 0 so non-translating callers keep
 * working unchanged.
 */

import type * as monaco from 'monaco-editor'
import type {
  CompletionItem as LspCompletionItem,
  CompletionList as LspCompletionList,
  Diagnostic as LspDiagnostic,
  DiagnosticSeverity as LspDiagnosticSeverity,
  Hover as LspHover,
  Location as LspLocation,
  Position as LspPosition,
  Range as LspRange,
  SignatureHelp as LspSignatureHelp,
  SymbolInformation as LspSymbolInformation,
  TextEdit as LspTextEdit,
} from 'vscode-languageserver-protocol'

import { getBodyLineOffset } from './body-offsets'

// ---------------------------------------------------------------------------
// Position / Range
// ---------------------------------------------------------------------------

export function monacoPositionToLsp(pos: monaco.IPosition, lineOffset = 0): LspPosition {
  return { line: pos.lineNumber - 1 + lineOffset, character: pos.column - 1 }
}

export function lspPositionToMonaco(pos: LspPosition, lineOffset = 0): monaco.IPosition {
  return { lineNumber: pos.line + 1 - lineOffset, column: pos.character + 1 }
}

export function lspRangeToMonaco(range: LspRange, lineOffset = 0): monaco.IRange {
  return {
    startLineNumber: range.start.line + 1 - lineOffset,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1 - lineOffset,
    endColumn: range.end.character + 1,
  }
}

export function monacoRangeToLsp(range: monaco.IRange, lineOffset = 0): LspRange {
  return {
    start: { line: range.startLineNumber - 1 + lineOffset, character: range.startColumn - 1 },
    end: { line: range.endLineNumber - 1 + lineOffset, character: range.endColumn - 1 },
  }
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/**
 * LSP severities are 1-indexed (1 = Error, 4 = Hint), Monaco's
 * `MarkerSeverity` is an enum (8 = Error, 4 = Warning, 2 = Info,
 * 1 = Hint).  Map explicitly rather than casting.
 *
 * `defaultSource` is the value used when the LSP diagnostic omits
 * `source` — typically the service's short name (`'strucpp'`,
 * `'pyright'`).  Surfaces in Monaco's hover as "from <source>".
 */
export function lspDiagnosticToMonaco(
  diag: LspDiagnostic,
  monacoApi: typeof monaco,
  lineOffset = 0,
  defaultSource = 'lsp',
): monaco.editor.IMarkerData {
  const severity = lspSeverityToMonaco(diag.severity, monacoApi)
  return {
    severity,
    message: diag.message,
    source: diag.source ?? defaultSource,
    ...lspRangeToMonaco(diag.range, lineOffset),
    ...(diag.code !== undefined ? { code: String(diag.code) } : {}),
  }
}

function lspSeverityToMonaco(
  severity: LspDiagnosticSeverity | undefined,
  monacoApi: typeof monaco,
): monaco.MarkerSeverity {
  switch (severity) {
    case 1: // Error
      return monacoApi.MarkerSeverity.Error
    case 2: // Warning
      return monacoApi.MarkerSeverity.Warning
    case 3: // Information
      return monacoApi.MarkerSeverity.Info
    case 4: // Hint
      return monacoApi.MarkerSeverity.Hint
    default:
      return monacoApi.MarkerSeverity.Error
  }
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

/**
 * LSP and Monaco use parallel `CompletionItemKind` enums.  Identical
 * for the kinds language services typically surface (keywords,
 * variables, functions, properties, fields).  Direct cast — the
 * values map 1:1 by spec.
 */
export function lspCompletionToMonaco(
  item: LspCompletionItem,
  defaultRange: monaco.IRange,
  monacoApi: typeof monaco,
  lineOffset = 0,
): monaco.languages.CompletionItem {
  const range = item.textEdit
    ? 'range' in item.textEdit
      ? lspRangeToMonaco(item.textEdit.range, lineOffset)
      : lspRangeToMonaco(item.textEdit.insert, lineOffset)
    : defaultRange

  const insertText = item.textEdit ? item.textEdit.newText : (item.insertText ?? item.label)

  // LSP `InsertTextFormat`: 1 = PlainText, 2 = Snippet.
  const insertTextRules =
    item.insertTextFormat === 2
      ? monacoApi.languages.CompletionItemInsertTextRule.InsertAsSnippet
      : monacoApi.languages.CompletionItemInsertTextRule.None

  return {
    label: item.label,
    kind: (item.kind ?? 1) as monaco.languages.CompletionItemKind,
    insertText,
    insertTextRules,
    range,
    ...(item.detail !== undefined ? { detail: item.detail } : {}),
    ...(item.documentation !== undefined
      ? {
          documentation: typeof item.documentation === 'string' ? item.documentation : item.documentation.value,
        }
      : {}),
    ...(item.sortText !== undefined ? { sortText: item.sortText } : {}),
    ...(item.filterText !== undefined ? { filterText: item.filterText } : {}),
    ...(item.preselect !== undefined ? { preselect: item.preselect } : {}),
  }
}

export function lspCompletionListToMonaco(
  list: LspCompletionList | LspCompletionItem[] | null,
  defaultRange: monaco.IRange,
  monacoApi: typeof monaco,
  lineOffset = 0,
): monaco.languages.CompletionList {
  if (!list) return { suggestions: [] }
  const items = Array.isArray(list) ? list : list.items
  const isIncomplete = Array.isArray(list) ? false : list.isIncomplete
  return {
    suggestions: items.map((item) => lspCompletionToMonaco(item, defaultRange, monacoApi, lineOffset)),
    incomplete: isIncomplete,
  }
}

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

export function lspHoverToMonaco(hover: LspHover | null, lineOffset = 0): monaco.languages.Hover | null {
  if (!hover) return null
  const contents = Array.isArray(hover.contents) ? hover.contents : [hover.contents]
  const monacoContents = contents.map((c) => {
    if (typeof c === 'string') return { value: c }
    if ('language' in c) return { value: `\`\`\`${c.language}\n${c.value}\n\`\`\`` }
    return { value: c.value }
  })
  return {
    contents: monacoContents,
    ...(hover.range ? { range: lspRangeToMonaco(hover.range, lineOffset) } : {}),
  }
}

// ---------------------------------------------------------------------------
// Definition / Location
// ---------------------------------------------------------------------------

// Location URIs may refer to ANY open document, not just the current
// one, so the body offset is looked up per-URI rather than passed in
// from the call site.  That keeps go-to-definition correct when the
// target URI has a different preamble length than the source URI
// (e.g. cross-POU navigation in ST, or cross-module in Python).
export function lspLocationToMonaco(loc: LspLocation): monaco.languages.Location {
  return {
    uri: { toString: () => loc.uri } as monaco.Uri,
    range: lspRangeToMonaco(loc.range, getBodyLineOffset(loc.uri)),
  }
}

export function lspLocationsToMonaco(
  locs: LspLocation | LspLocation[] | null,
  monacoApi: typeof monaco,
): monaco.languages.Definition | null {
  if (!locs) return null
  const arr = Array.isArray(locs) ? locs : [locs]
  return arr.map((l) => ({
    uri: monacoApi.Uri.parse(l.uri),
    range: lspRangeToMonaco(l.range, getBodyLineOffset(l.uri)),
  }))
}

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

export function lspSymbolKindToMonaco(kind: number): monaco.languages.SymbolKind {
  // LSP and Monaco both use numeric SymbolKind enums that line up
  // for the subset language services typically surface.
  return (kind - 1) as monaco.languages.SymbolKind
}

/**
 * Convert an LSP `SymbolInformation` to Monaco's
 * `DocumentSymbol`-compatible shape used by workspace-symbol
 * providers.  Monaco doesn't expose a public `SymbolInformation`
 * type; the workspace-symbol provider contract returns objects
 * with at least `name`, `kind`, and `location`.
 */
export function lspSymbolToMonaco(sym: LspSymbolInformation): {
  name: string
  kind: monaco.languages.SymbolKind
  location: monaco.languages.Location
  containerName: string
  tags: monaco.languages.SymbolTag[]
} {
  return {
    name: sym.name,
    kind: lspSymbolKindToMonaco(sym.kind),
    location: lspLocationToMonaco(sym.location),
    containerName: sym.containerName ?? '',
    tags: [],
  }
}

// ---------------------------------------------------------------------------
// Text edits (used by rename + formatting)
// ---------------------------------------------------------------------------

export function lspTextEditToMonaco(edit: LspTextEdit, lineOffset = 0): monaco.languages.TextEdit {
  return {
    range: lspRangeToMonaco(edit.range, lineOffset),
    text: edit.newText,
  }
}

// ---------------------------------------------------------------------------
// Signature help
// ---------------------------------------------------------------------------

export function lspSignatureHelpToMonaco(help: LspSignatureHelp | null): monaco.languages.SignatureHelp | null {
  if (!help) return null
  return {
    signatures: help.signatures.map((sig) => ({
      label: sig.label,
      documentation: typeof sig.documentation === 'string' ? sig.documentation : sig.documentation?.value,
      parameters: (sig.parameters ?? []).map((p) => ({
        label: p.label,
        documentation: typeof p.documentation === 'string' ? p.documentation : p.documentation?.value,
      })),
    })),
    activeSignature: help.activeSignature ?? 0,
    activeParameter: help.activeParameter ?? 0,
  }
}
