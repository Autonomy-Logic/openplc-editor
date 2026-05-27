// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Pyright LSP integration for Python POU bodies.
 *
 * The OpenPLC compiler wraps the user's Python body with a shared-
 * memory glue layer at build time (see `injectPythonRuntime`):
 * `input` / `output` IEC variables come into scope as module-level
 * globals before the user's `block_loop` runs.  Pyright, however,
 * only ever sees what the editor shows — the raw user body — so
 * names like `red_light` would surface as "undefined" diagnostics
 * even though the compiled program runs fine.
 *
 * To bridge that gap, this module:
 *
 *   1. Disables `monaco-pyright-lsp`'s built-in auto-registration of
 *      hover / completion / diagnostic providers (those ship raw
 *      `model.getValue()` to Pyright on every interaction, which
 *      would clobber the augmented document we want it to analyse).
 *
 *   2. Maintains a per-POU preamble (built by
 *      `generatePythonLspPreamble` from the project's variables
 *      table) and prepends it to the document text on every push to
 *      Pyright.
 *
 *   3. Registers our own Monaco hover / completion / diagnostic
 *      providers that send `preamble + user-code` to Pyright and
 *      offset incoming line numbers / ranges by `preamble.lineCount`
 *      so the markers and ranges Monaco renders land on the user's
 *      actual line numbers — not the preamble's.
 *
 * The preamble registry is keyed by POU name and read at request
 * time so switching POUs / toggling variables only updates a Map
 * entry, never the Monaco model.
 */
import {
  generatePythonLspPreamble,
  type PythonLspPreamble,
} from '@root/frontend/utils/python/generatePythonLspPreamble'
import type { PLCVariable } from '@root/middleware/shared/ports/types'
import { debounce } from 'lodash'
import type { editor as MonacoEditor, IDisposable } from 'monaco-editor'
import type * as monaco from 'monaco-editor'
import { MonacoPyrightProvider } from 'monaco-pyright-lsp'

const EMPTY_PREAMBLE: PythonLspPreamble = { text: '', lineCount: 0 }
const DIAGNOSTICS_INTERVAL_MS = 1000

/** Per-POU preamble registry.  Updated when variables change so the
 *  next document push (typing / cursor move / explicit refresh) ships
 *  the new declarations to Pyright. */
const preambleByPou = new Map<string, PythonLspPreamble>()

/** Track which POU each open Monaco model belongs to so the language
 *  providers (hover / completion) can pick the right preamble at
 *  request time. */
const pouNameByModelUri = new Map<string, string>()

/** Global Monaco disposables (hover / completion providers).  Live
 *  as long as the LSP runtime itself. */
const globalDisposables: IDisposable[] = []

/** Per-editor wiring (diagnostics listener + refresh trigger).
 *  Keyed by Monaco model URI string so multiple Python POUs open in
 *  parallel each get their own debounce timer and dispose
 *  independently on tab close. */
interface EditorWiring {
  pouName: string
  triggerDiagnosticsRefresh: () => void
  dispose(): void
}
const wiringsByModelUri = new Map<string, EditorWiring>()

let pyrightProvider: MonacoPyrightProvider | null = null
let initPromise: Promise<void> | null = null
let monacoApi: typeof monaco | null = null

/** Initialise the Pyright worker + register custom hover / completion
 *  language providers.  Safe to call multiple times — concurrent calls
 *  share the in-flight promise so a tab-switch race during startup
 *  doesn't spawn two workers. */
export async function initPythonLSP(monacoModule: typeof monaco): Promise<void> {
  if (pyrightProvider) return
  if (initPromise) return initPromise

  initPromise = (async () => {
    monacoApi = monacoModule
    // Disable every auto-registered feature: each of them would
    // otherwise send `model.getValue()` (the raw, preamble-less
    // text) to Pyright, clobbering the augmented document we just
    // pushed.  We still rely on the library for the worker lifecycle
    // and the `lspClient` primitive interface.
    const provider = new MonacoPyrightProvider(undefined, {
      features: {
        hover: false,
        completion: false,
        signatureHelp: false,
        diagnostic: false,
        rename: false,
        findDefinition: false,
      },
      diagnosticsInterval: DIAGNOSTICS_INTERVAL_MS,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- monaco version mismatch between project and monaco-pyright-lsp
    await provider.init(monacoModule as any)
    pyrightProvider = provider

    globalDisposables.push(
      monacoModule.languages.registerHoverProvider('python', {
        provideHover: (model, position) => provideHover(model, position),
      }),
    )
    globalDisposables.push(
      monacoModule.languages.registerCompletionItemProvider('python', {
        triggerCharacters: ['.', '[', '"', "'"],
        provideCompletionItems: (model, position) => provideCompletions(model, position),
      }),
    )
    globalDisposables.push(
      monacoModule.languages.registerSignatureHelpProvider('python', {
        signatureHelpTriggerCharacters: ['(', ','],
        signatureHelpRetriggerCharacters: [')'],
        provideSignatureHelp: (model, position) => provideSignatureHelp(model, position),
      }),
    )
    // Semantic tokens (the "colour known identifiers / functions
    // differently from typos" feature) intentionally NOT registered.
    // `monaco-pyright-lsp` ships a pyright worker bundle that never
    // wires `textDocument/semanticTokens/full` to a handler — every
    // request comes back as `ResponseError: Unhandled method`
    // regardless of what the client advertises on initialize.  The
    // four matches for the request method string in
    // `node_modules/monaco-pyright-lsp/dist/worker.js` are all
    // protocol-type declarations, never `onRequest` registrations.
    // Restoring the feature requires forking the library to add the
    // handler in its worker, or rebuilding pyright as a browser
    // worker from scratch — both out of scope for this iteration.
    // Body editors continue to syntax-highlight via Monaco's Monarch
    // tokenizer (keywords / strings / numbers); user identifiers and
    // function calls stay un-coloured.
  })()

  return initPromise
}

/** Attach this Monaco editor to the Python LSP flow for the given
 *  POU.  Builds the preamble from `variables`, pushes the augmented
 *  document to Pyright once, and wires the editor's change events
 *  to keep the augmented document in sync. */
export async function setupPythonLSPForEditor(
  editor: MonacoEditor.IStandaloneCodeEditor,
  ctx: { pouName: string; variables: PLCVariable[] },
): Promise<void> {
  if (!pyrightProvider) return
  const model = editor.getModel()
  if (!model) return

  const uri = model.uri.toString()
  preambleByPou.set(ctx.pouName, generatePythonLspPreamble(ctx.variables))
  pouNameByModelUri.set(uri, ctx.pouName)

  // Replace any previous wiring for this model (tab close / reopen).
  wiringsByModelUri.get(uri)?.dispose()

  // Diagnostics callback is global to the LSP client — `setup-
  // DiagnosticsCallback` overwrites the previous one each call.
  // Our callback offsets line numbers back to the user's view and
  // drops anything that lands inside the preamble (those are
  // synthetic declarations the user never wrote — surfacing
  // them would confuse).
  await pyrightProvider.lspClient.setupDiagnosticsCallback((diagnostics) => {
    const monacoMod = monacoApi
    if (!monacoMod) return
    const preamble = preambleByPou.get(ctx.pouName) ?? EMPTY_PREAMBLE
    const markers: MonacoEditor.IMarkerData[] = []
    for (const diag of diagnostics) {
      if (diag.range.start.line < preamble.lineCount) continue
      markers.push({
        startLineNumber: diag.range.start.line - preamble.lineCount + 1,
        startColumn: diag.range.start.character + 1,
        endLineNumber: diag.range.end.line - preamble.lineCount + 1,
        endColumn: diag.range.end.character + 1,
        severity: convertDiagnosticSeverity(monacoMod, diag.severity),
        message: diag.message,
      })
    }
    monacoMod.editor.setModelMarkers(model, 'Pyright', markers)
  })

  const pushDocToPyright = () => {
    if (!pyrightProvider) return
    const preamble = preambleByPou.get(ctx.pouName) ?? EMPTY_PREAMBLE
    const augmented = preamble.text + model.getValue()
    void pyrightProvider.lspClient.updateDocVersion(augmented)
  }

  // Lead on the first change of a burst so quick typing still
  // triggers a fast analysis; trail to coalesce sustained edits.
  // Mirrors the cadence the library's setupDiagnostics uses.
  const debouncedPush = debounce(pushDocToPyright, DIAGNOSTICS_INTERVAL_MS, {
    leading: true,
    trailing: true,
  })

  const changeListener = editor.onDidChangeModelContent(() => {
    debouncedPush()
  })

  // Prime immediately so the user gets diagnostics on first open
  // without having to type anything.
  pushDocToPyright()

  wiringsByModelUri.set(uri, {
    pouName: ctx.pouName,
    triggerDiagnosticsRefresh: pushDocToPyright,
    dispose() {
      debouncedPush.cancel()
      changeListener.dispose()
    },
  })
}

/** Re-build the preamble for a POU whose variables-table state has
 *  changed and re-push the augmented document so Pyright re-analyses
 *  against the new declarations.  Safe to call before
 *  `setupPythonLSPForEditor` — the new preamble is stored and the
 *  next attach will pick it up. */
export function updatePythonLspContext(pouName: string, variables: PLCVariable[]): void {
  preambleByPou.set(pouName, generatePythonLspPreamble(variables))
  for (const wiring of wiringsByModelUri.values()) {
    if (wiring.pouName === pouName) wiring.triggerDiagnosticsRefresh()
  }
}

/** Tear down the LSP wiring entirely (worker, providers, per-editor
 *  listeners).  Used when navigating away from any Python POU. */
export function cleanupPythonLSP(): void {
  for (const w of wiringsByModelUri.values()) w.dispose()
  wiringsByModelUri.clear()
  pouNameByModelUri.clear()
  preambleByPou.clear()
  for (const d of globalDisposables) d.dispose()
  globalDisposables.length = 0

  const provider = pyrightProvider
  pyrightProvider = null
  initPromise = null
  monacoApi = null

  if (provider) {
    provider.stopDiagnostics().catch(() => {
      /* ignore */
    })
  }
}

// ---------------------------------------------------------------------------
// Language provider implementations
// ---------------------------------------------------------------------------

async function provideHover(
  model: MonacoEditor.ITextModel,
  position: monaco.Position,
): Promise<monaco.languages.Hover | null> {
  if (!pyrightProvider) return null
  const preamble = preambleForModel(model)
  const augmented = preamble.text + model.getValue()
  const hover = await pyrightProvider.lspClient.getHoverInfo(augmented, {
    line: position.lineNumber - 1 + preamble.lineCount,
    character: position.column - 1,
  })
  if (!hover) return null
  const value = typeof hover.contents === 'string' ? hover.contents : extractMarkupValue(hover.contents)
  if (!value) return null
  return {
    contents: [{ value }],
    ...(hover.range ? { range: offsetRange(hover.range, preamble.lineCount) } : {}),
  }
}

async function provideCompletions(
  model: MonacoEditor.ITextModel,
  position: monaco.Position,
): Promise<monaco.languages.CompletionList> {
  if (!pyrightProvider) return { suggestions: [] }
  const preamble = preambleForModel(model)
  const augmented = preamble.text + model.getValue()
  const result = await pyrightProvider.lspClient.getCompletion(augmented, {
    line: position.lineNumber - 1 + preamble.lineCount,
    character: position.column - 1,
  })
  if (!result) return { suggestions: [] }
  const items = Array.isArray(result) ? result : result.items
  // Pyright usually omits `textEdit` and leaves the host to figure
  // out which slice of the user's text the completion replaces.
  // Monaco needs an explicit `range` on every item — that range is
  // also what it filters against when matching the user's typed
  // prefix.  Resolve the word at the cursor once and reuse it as
  // the default; items with their own `textEdit` still win.
  const defaultRange = wordRangeAtPosition(model, position)
  return {
    suggestions: items.map((item) => convertCompletionItem(item, preamble.lineCount, defaultRange)),
  }
}

async function provideSignatureHelp(
  model: MonacoEditor.ITextModel,
  position: monaco.Position,
): Promise<monaco.languages.SignatureHelpResult | null> {
  if (!pyrightProvider) return null
  const preamble = preambleForModel(model)
  const augmented = preamble.text + model.getValue()
  const sig = await pyrightProvider.lspClient.getSignatureHelp(augmented, {
    line: position.lineNumber - 1 + preamble.lineCount,
    character: position.column - 1,
  })
  if (!sig || sig.signatures.length === 0) return null
  return {
    value: {
      signatures: sig.signatures.map((s) => ({
        label: s.label,
        documentation: extractMarkupValue(s.documentation) || undefined,
        parameters: (s.parameters ?? []).map((p) => ({
          label: p.label,
          documentation: extractMarkupValue(p.documentation) || undefined,
        })),
        // `activeParameter` on the signature itself takes precedence
        // over the top-level one per LSP spec; pass it through when
        // Pyright sets it.
        ...(s.activeParameter !== undefined ? { activeParameter: s.activeParameter } : {}),
      })),
      activeSignature: sig.activeSignature ?? 0,
      activeParameter: sig.activeParameter ?? 0,
    },
    dispose: () => {
      /* no-op */
    },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function preambleForModel(model: MonacoEditor.ITextModel): PythonLspPreamble {
  const pouName = pouNameByModelUri.get(model.uri.toString())
  if (!pouName) return EMPTY_PREAMBLE
  return preambleByPou.get(pouName) ?? EMPTY_PREAMBLE
}

interface LspRange {
  start: { line: number; character: number }
  end: { line: number; character: number }
}

function offsetRange(range: LspRange, preambleLineCount: number): monaco.IRange {
  return {
    startLineNumber: Math.max(1, range.start.line - preambleLineCount + 1),
    startColumn: range.start.character + 1,
    endLineNumber: Math.max(1, range.end.line - preambleLineCount + 1),
    endColumn: range.end.character + 1,
  }
}

function extractMarkupValue(contents: unknown): string {
  // vscode-languageserver's `Hover.contents` can be a string, a
  // MarkupContent, a MarkedString, or an array of either.  Pyright
  // returns MarkupContent in practice; render its `.value`.  Defensive
  // stringification keeps a future protocol-shape change from
  // blanking the tooltip entirely.
  if (Array.isArray(contents)) {
    return contents
      .map((c) => (typeof c === 'string' ? c : ((c as { value?: string }).value ?? '')))
      .filter(Boolean)
      .join('\n\n')
  }
  if (typeof contents === 'object' && contents !== null && 'value' in contents) {
    const v = (contents as { value?: string }).value
    return typeof v === 'string' ? v : ''
  }
  return ''
}

interface LspCompletionItem {
  label: string
  kind?: number
  detail?: string
  documentation?: string | { value?: string }
  sortText?: string
  filterText?: string
  insertText?: string
  textEdit?: {
    range?: LspRange
    insert?: LspRange
    replace?: LspRange
    newText: string
  }
}

function convertCompletionItem(
  item: LspCompletionItem,
  preambleLineCount: number,
  defaultRange: monaco.IRange,
): monaco.languages.CompletionItem {
  const doc = item.documentation
  const docValue = typeof doc === 'string' ? doc : (doc?.value ?? undefined)
  const textEditRange = item.textEdit?.range ?? item.textEdit?.insert ?? item.textEdit?.replace
  const range = textEditRange ? offsetRange(textEditRange, preambleLineCount) : defaultRange
  return {
    label: item.label,
    kind: convertCompletionItemKind(item.kind),
    insertText: item.textEdit?.newText ?? item.insertText ?? item.label,
    ...(item.detail !== undefined ? { detail: item.detail } : {}),
    ...(docValue !== undefined ? { documentation: { value: docValue } } : {}),
    ...(item.sortText !== undefined ? { sortText: item.sortText } : {}),
    ...(item.filterText !== undefined ? { filterText: item.filterText } : {}),
    // `range` is what Monaco uses to filter completions against the
    // user's typed prefix.  Items the LSP gave a `textEdit` already
    // carry their own range; everything else falls back to the word
    // at the cursor — that's the slice the user is currently typing,
    // and the only range that lets Monaco match items correctly.
    range,
  }
}

/**
 * Compute the range covering the word immediately before the
 * cursor — the slice Monaco filters completions against and the
 * slice the accepted text will replace.  Uses `getWordUntilPosition`
 * (not `getWordAtPosition`) so the range stops AT the cursor even
 * when the user is mid-word: typing `va` at column 3 yields the
 * range `1..3`, not `1..end-of-word`, so Monaco filters items by
 * `va` rather than the partially-typed full word.
 */
function wordRangeAtPosition(model: MonacoEditor.ITextModel, position: monaco.Position): monaco.IRange {
  const word = model.getWordUntilPosition(position)
  return {
    startLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  }
}

/**
 * Map LSP `CompletionItemKind` (1-based) onto Monaco's
 * `CompletionItemKind` enum (0-based, ordered differently — see
 * `monaco-editor/esm/vs/editor/common/languages.ts`).  Naively
 * casting one to the other was misclassifying every item: Pyright's
 * `Variable` (LSP 6) was landing on Monaco's `Struct` (Monaco 6)
 * and `Function` (LSP 3) on `Field` (Monaco 3).  This affects the
 * icon and Monaco's internal grouping; downstream filtering uses
 * `label` / `filterText` regardless, but the icons should match.
 */
function convertCompletionItemKind(kind: number | undefined): monaco.languages.CompletionItemKind {
  // We only need to encode the kinds Pyright actually emits.  Anything
  // unmapped falls through to Variable so it still shows with a sane
  // glyph.  Numeric literals here are the Monaco enum values; keeping
  // them as numbers avoids carrying `monaco-editor` enum lookups at
  // every callsite.  Reference:
  //   monaco-editor: Method=0, Function=1, Constructor=2, Field=3,
  //                  Variable=4, Class=5, Struct=6, Interface=7,
  //                  Module=8, Property=9, Event=10, Operator=11,
  //                  Unit=12, Value=13, Constant=14, Enum=15,
  //                  EnumMember=16, Keyword=17, Text=18, Color=19,
  //                  File=20, Reference=21, Customcolor=22,
  //                  Folder=23, TypeParameter=24, User=25,
  //                  Issue=26, Snippet=27
  switch (kind) {
    case 1:
      return 18 as monaco.languages.CompletionItemKind // Text → Text
    case 2:
      return 0 as monaco.languages.CompletionItemKind // Method
    case 3:
      return 1 as monaco.languages.CompletionItemKind // Function
    case 4:
      return 2 as monaco.languages.CompletionItemKind // Constructor
    case 5:
      return 3 as monaco.languages.CompletionItemKind // Field
    case 6:
      return 4 as monaco.languages.CompletionItemKind // Variable
    case 7:
      return 5 as monaco.languages.CompletionItemKind // Class
    case 8:
      return 7 as monaco.languages.CompletionItemKind // Interface
    case 9:
      return 8 as monaco.languages.CompletionItemKind // Module
    case 10:
      return 9 as monaco.languages.CompletionItemKind // Property
    case 11:
      return 12 as monaco.languages.CompletionItemKind // Unit
    case 12:
      return 13 as monaco.languages.CompletionItemKind // Value
    case 13:
      return 15 as monaco.languages.CompletionItemKind // Enum
    case 14:
      return 17 as monaco.languages.CompletionItemKind // Keyword
    case 15:
      return 27 as monaco.languages.CompletionItemKind // Snippet
    case 16:
      return 19 as monaco.languages.CompletionItemKind // Color
    case 17:
      return 20 as monaco.languages.CompletionItemKind // File
    case 18:
      return 21 as monaco.languages.CompletionItemKind // Reference
    case 19:
      return 23 as monaco.languages.CompletionItemKind // Folder
    case 20:
      return 16 as monaco.languages.CompletionItemKind // EnumMember
    case 21:
      return 14 as monaco.languages.CompletionItemKind // Constant
    case 22:
      return 6 as monaco.languages.CompletionItemKind // Struct
    case 23:
      return 10 as monaco.languages.CompletionItemKind // Event
    case 24:
      return 11 as monaco.languages.CompletionItemKind // Operator
    case 25:
      return 24 as monaco.languages.CompletionItemKind // TypeParameter
    default:
      return 4 as monaco.languages.CompletionItemKind // Variable
  }
}

function convertDiagnosticSeverity(
  monacoMod: typeof monaco,
  severity: number | undefined,
): MonacoEditor.IMarkerData['severity'] {
  // LSP DiagnosticSeverity: 1=Error, 2=Warning, 3=Info, 4=Hint
  switch (severity) {
    case 1:
      return monacoMod.MarkerSeverity.Error
    case 2:
      return monacoMod.MarkerSeverity.Warning
    case 3:
      return monacoMod.MarkerSeverity.Info
    case 4:
      return monacoMod.MarkerSeverity.Hint
    default:
      return monacoMod.MarkerSeverity.Hint
  }
}
