// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Python LSP service orchestrator.
 *
 * Thin adapter over `lsp-shared/startLanguageService` that wires
 * the `browser-basedpyright` worker into the editor's Monaco
 * surface.
 *
 * The Python POU body the user edits is **not** what the OpenPLC
 * compiler eventually ships to Pyright — the runtime glue layer
 * (`injectPythonRuntime`) hoists every `input` / `output` IEC
 * variable declared in the variables table into the Python module
 * scope before `block_loop` runs.  Pyright only sees what we send
 * it, though, so without intervention names like `red_light`
 * surface as "undefined" diagnostics even when the compiled
 * program runs fine.
 *
 * The fix is the same preamble trick the ST service uses: prepend
 * a synthetic `# IEC variables` block declaring every
 * `input`/`output` as a typed module global, push the augmented
 * document to Pyright, and record the preamble's line count in
 * the shared body-offset registry so every LSP coordinate the
 * providers see is already in the body-only frame the user reads.
 *
 * Lifetime is the application's lifetime; started once at app
 * boot, disposed only at shutdown.
 */

import { getIecVariableLineMap } from '../../utils/generate-iec-variables-to-string'
import { generatePythonLspPreamble, type PythonLspPreamble } from '../../utils/python/generatePythonLspPreamble'
import {
  deleteBodyLineOffset,
  getBodyLineOffset,
  type LanguageService,
  lspLocationsToMonaco,
  setBodyLineOffset,
  startLanguageService,
  suppressNoDefinitionFound,
} from '../lsp-shared'
import { redirectPythonDefinitionToStore } from './goto-definition-redirect'
import type { PythonLspService, PythonLspStartOptions } from './types'

const PYTHON_LANGUAGE_ID = 'python'
const PYTHON_WORKER_NAME = 'python-lsp'
const MARKER_OWNER = 'python-lsp'
const DIAGNOSTIC_SOURCE = 'pyright'

const EMPTY_PREAMBLE: PythonLspPreamble = {
  text: '',
  lineCount: 0,
  variableNameByPreambleLine: new Map(),
}

export function startPythonLsp(opts: PythonLspStartOptions): PythonLspService {
  const { workerUrl, monaco: monacoApi, onCrash } = opts

  // Captured from `beforeListen` so attachPou / detachPou can send
  // `pyright/createFile` / `pyright/deleteFile` alongside didOpen /
  // didClose.  basedpyright only treats files that exist in its
  // in-memory `TestFileSystem` as workspace members, and only
  // workspace members get `publishDiagnostics` — without these
  // notifications the document buffer is populated but never
  // enters the analysis queue.
  let pyrightConnection: import('vscode-jsonrpc/browser').MessageConnection | null = null

  // Per-URI registry, keyed by Monaco model URI.  Holds the
  // preamble Pyright sees concatenated with the user body, the LSP
  // URI (model URI + `.py` — basedpyright runs full analysis only
  // on `.py`-suffixed documents), the POU name the Go to Definition
  // redirect uses to open the right tab, and the variable-name →
  // Monaco-line map the redirect uses to cross from a preamble
  // target into the IEC variables-code editor.
  interface UriEntry {
    pouName: string
    lspUri: string
    preamble: PythonLspPreamble
    iecVariableLineMap: Map<string, { line: number; column: number }>
  }
  const entryByUri = new Map<string, UriEntry>()

  function lspUriFor(modelUri: string): string {
    return entryByUri.get(modelUri)?.lspUri ?? `${modelUri}.py`
  }

  function modelUriFor(lspUri: string): string {
    // The forward mapping always appends `.py`; the reverse is a
    // suffix strip.  Defensive: if a URI doesn't end in `.py` (a
    // typeshed stub or a previously-known model URI sneaking
    // through), pass it through unchanged.
    return lspUri.endsWith('.py') ? lspUri.slice(0, -3) : lspUri
  }

  function augmentedDocument(modelUri: string, body: string): string {
    const preamble = entryByUri.get(modelUri)?.preamble ?? EMPTY_PREAMBLE
    return preamble.text + body
  }

  const sharedService: LanguageService = startLanguageService({
    languageId: PYTHON_LANGUAGE_ID,
    workerName: PYTHON_WORKER_NAME,
    workerUrl,
    ...(monacoApi ? { monaco: monacoApi } : {}),

    // Pyright's completion trigger chars cover the common cases:
    // member access (`.`), subscript / dict key (`[`), string-start
    // (`"`/`'`).  Matches what monaco-pyright-lsp registered before.
    completionTriggerCharacters: ['.', '[', '"', "'"],
    signatureHelpTriggerCharacters: ['(', ','],

    // URI rewriting: Monaco's model URI is the user's real file
    // path (`file:///…/python_something` with no extension),
    // basedpyright needs a `.py` extension to run full analysis on
    // the document (without it, hover + completion still work via
    // on-demand queries but `publishDiagnostics` is never sent).
    // Map model URI → LSP URI on the way out and back on the way
    // in so the rest of the editor never sees the synthetic
    // suffix.  Body-line offsets stay keyed by the LSP URI — the
    // shared converters read them through `getBodyLineOffset(lspUri)`
    // when handling pyright responses.
    resolveLspContext: (modelUri) => {
      const lspUri = lspUriFor(modelUri)
      return { lspUri, lineOffset: getBodyLineOffset(lspUri) }
    },
    resolveDiagnosticsModelUri: modelUriFor,

    // Go-to-definition routing.  Two layers, in order:
    //
    //   1. **Store redirect** (`redirectPythonDefinitionToStore`):
    //      for targets in the source URI's preamble, open the POU
    //      tab, switch the variables panel to code mode, and place
    //      the variables-code-editor cursor at the declaration.
    //      Mirrors the ST LSP's `redirectDefinitionToStore`.  Body
    //      targets in the same URI route through `routeToPouBody`
    //      so the navigation goes through the store and the tab
    //      list stays consistent.
    //
    //   2. **URI-reachability filter** (fallback):
    //
    //        - Click on a stdlib name (`print`, `os.path`, …) →
    //          Pyright returns a Location targeting the bundled
    //          typeshed (`file:///typeshed/stdlib/builtins.pyi`).
    //          Monaco has no model for that URI, so opening the
    //          peek widget throws `Model not found` and crashes
    //          the renderer.  Drop those before they reach Monaco.
    //        - Anything that survives the drop is a navigable
    //          in-model target the redirect didn't claim — hand it
    //          to Monaco unchanged.
    //
    // Returning `suppressNoDefinitionFound` keeps Monaco quiet
    // (no banner, no peek) when there's nowhere navigable to go.
    definitionInterceptors: [
      (locations, model, position, monacoApi) => {
        const modelUri = model.uri.toString()
        const entry = entryByUri.get(modelUri)

        // Pyright's Locations come back with the LSP URI (model URI
        // + `.py`).  Compare against entry.lspUri inside the
        // redirect so the "same document?" check matches; the
        // routeTo* helpers only need the POU name + IEC line/col
        // they get from the maps.
        if (entry) {
          for (const loc of locations) {
            const handled = redirectPythonDefinitionToStore(loc, {
              sourceUri: entry.lspUri,
              sourcePouName: entry.pouName,
              variableNameByPreambleLine: entry.preamble.variableNameByPreambleLine,
              iecVariableLineMap: entry.iecVariableLineMap,
            })
            if (handled) return suppressNoDefinitionFound(model, position, monacoApi)
          }
        }

        // Nothing redirectable.  Fall back to filtering out targets
        // Monaco can't open (typeshed stubs, external imports).
        // Pyright reports targets in LSP-URI space (with `.py`); the
        // model lookup needs the extension-less Monaco model URI.
        const navigable = locations.filter((loc) =>
          monacoApi.editor.getModels().some((m) => m.uri.toString() === modelUriFor(loc.uri)),
        )

        if (navigable.length === 0) {
          return suppressNoDefinitionFound(model, position, monacoApi)
        }
        return lspLocationsToMonaco(navigable, monacoApi) ?? null
      },
    ],

    markerOwner: MARKER_OWNER,
    diagnosticSource: DIAGNOSTIC_SOURCE,

    // Pyright needs a workspace folder to load `pyrightconfig.json`;
    // without one, every project setting falls back to defaults that
    // break our setup.  The actual filesystem is the in-memory FS the
    // worker maintains, so the URI is virtual — we anchor at
    // `file:///` because that's where the typeshed files end up too
    // (basedpyright applies `typeshed-json` paths starting with
    // `/typeshed/…`, which is under root `/`).
    rootUri: 'file:///',
    workspaceFolders: [{ name: 'openplc', uri: 'file:///' }],

    // basedpyright's `initialize` handler does
    //   `const { files } = params.initializationOptions`
    // and crashes if `initializationOptions` is undefined.  Beyond
    // that, the `files` map is the gateway by which our typeshed
    // override reaches Pyright's in-memory FS:
    //
    //   - `browser-pyright`'s rspack config builds a virtual
    //     `typeshed-json` module by reading the `docstubs/`
    //     directory and rewriting every path to `/typeshed/…`.
    //     `basedpyright`'s `browser-server.ts` then spreads that
    //     map plus our `files` into the FS via
    //     `TestFileSystem.apply(initialFiles)`.
    //
    //   - But `pyright-internal/src/common/pathConsts.ts` exports
    //     `typeshedFallback = 'typeshed-fallback'`, which is what
    //     `ImportResolver` joins to its root when nothing better
    //     is configured.  So Pyright looks under
    //     `/typeshed-fallback/stdlib/builtins.pyi` while the actual
    //     stubs live at `/typeshed/stdlib/builtins.pyi`.  Path
    //     mismatch → every builtin resolves to `Unknown` → every
    //     annotation that references one (including our
    //     `: bool` IEC preamble) hovers as `Unknown`.
    //
    // The workaround is a `pyrightconfig.json` in the workspace
    // root that sets `typeshedPath` explicitly.  Pyright loads it,
    // overrides the constant, and looks up stubs at the right
    // path.  We include the file in the initial `files` map so
    // it lands in the FS alongside the typeshed.
    //
    // `include: ['**/*.py']` scopes workspace analysis to user
    // sources.  Without it basedpyright walks the entire FS root
    // including the 3799-file typeshed, queues every one for
    // analysis, and `publishDiagnostics` for the file the user
    // actually opened never gets a turn.  The typeshed itself is
    // `.pyi`, so a `.py`-only glob filters it out cleanly.
    initializationOptions: {
      files: {
        '/pyrightconfig.json': JSON.stringify({
          typeshedPath: '/typeshed',
          include: ['**/*.py'],
        }),
      },
    },

    // `browser-basedpyright` (microbit-foundation pyright fork) has
    // a foreground/background two-worker architecture.  The bundle
    // we spawn is the foreground; before it speaks JSON-RPC it
    // needs `{type: 'browser/boot', mode: 'foreground'}`, and once
    // it boots it will ask us to spawn matching background workers
    // by posting `{type: 'browser/newWorker', initialData, port}`.
    // We handle that by `new Worker(workerUrl)` on the same bundle
    // and transferring the port over via another `browser/boot`,
    // mode `'background'`.  Without this dance the foreground
    // worker silently hangs on `initialize` waiting for its
    // background twin and nothing the user does ever resolves.
    // Reference: https://github.com/microbit-foundation/pyright/blob/microbit/THIS_FORK.md
    setupWorker: (worker, url) => {
      const backgroundWorkers: Worker[] = []
      worker.postMessage({ type: 'browser/boot', mode: 'foreground' })
      worker.addEventListener('message', (event: MessageEvent) => {
        const data = event.data as { type?: string; initialData?: unknown; port?: MessagePort } | null
        if (!data || data.type !== 'browser/newWorker' || !data.port) return
        const background = new Worker(url, { name: `${PYTHON_WORKER_NAME}-bg-${backgroundWorkers.length + 1}` })
        backgroundWorkers.push(background)
        background.postMessage(
          {
            type: 'browser/boot',
            mode: 'background',
            initialData: data.initialData,
            port: data.port,
          },
          [data.port],
        )
      })
      // Best-effort cleanup of the background fleet when the
      // foreground is torn down.  The transport's `dispose()`
      // terminates the foreground; we hook the `terminate` event
      // by piggybacking on the `error` event the connection emits
      // during dispose-induced reads.  If a background outlives
      // the foreground it'll exit shortly anyway when its message
      // channel drops.
      worker.addEventListener('error', () => {
        for (const bg of backgroundWorkers) bg.terminate()
      })
    },

    // Capture the connection so attachPou / detachPou can send
    // `pyright/createFile` / `pyright/deleteFile` notifications.
    // These manage basedpyright's in-memory FS workspace membership;
    // see `pyrightConnection` above for the rationale.
    beforeListen: (connection) => {
      pyrightConnection = connection
    },

    ...(onCrash ? { onCrash } : {}),
  })

  return {
    ready: sharedService.ready,

    attachPou(uri, pouName, variables, bodyText) {
      // `uri` is the Monaco model URI the rest of the editor uses.
      // The LSP communication appends `.py` so basedpyright treats
      // the document as Python source.  Body-line offsets are
      // keyed by the LSP URI so the shared converters that process
      // pyright's responses look the offset up by the same URI
      // pyright reports.
      //
      // Order matters: send `pyright/createFile` BEFORE `didOpen`.
      // basedpyright's TestFileSystem-backed workspace only
      // considers files that exist in the FS as workspace members,
      // and only workspace members get diagnostic publication.
      // `createFile` writes an empty entry at the LSP URI's path;
      // the subsequent `didOpen` then populates the document
      // buffer pyright actually analyses.  Without the createFile
      // notification, opened files sit in pyright's document
      // buffer but never enter the analysis queue.
      const lspUri = `${uri}.py`
      const preamble = generatePythonLspPreamble(variables)
      const iecVariableLineMap = getIecVariableLineMap(variables)
      entryByUri.set(uri, { pouName, lspUri, preamble, iecVariableLineMap })
      setBodyLineOffset(lspUri, preamble.lineCount)
      void pyrightConnection?.sendNotification('pyright/createFile', { kind: 'create', uri: lspUri })
      sharedService.openDocument(lspUri, augmentedDocument(uri, bodyText))
    },

    notifyBodyChange(uri, bodyText) {
      const lspUri = lspUriFor(uri)
      sharedService.changeDocument(lspUri, augmentedDocument(uri, bodyText))
    },

    notifyVariablesChange(uri, variables, bodyText) {
      // Variables changed: regenerate the preamble + IEC line map
      // and update the offset registry BEFORE pushing the new
      // document so the diagnostics callback (which fires on the
      // next round-trip) reads the new offset rather than the
      // stale one.  Preserve the recorded pouName + lspUri — a
      // pure variables edit doesn't change the POU's identity or
      // the URI we already opened with pyright.
      const existing = entryByUri.get(uri)
      const lspUri = existing?.lspUri ?? `${uri}.py`
      const preamble = generatePythonLspPreamble(variables)
      const iecVariableLineMap = getIecVariableLineMap(variables)
      entryByUri.set(uri, { pouName: existing?.pouName ?? '', lspUri, preamble, iecVariableLineMap })
      setBodyLineOffset(lspUri, preamble.lineCount)
      sharedService.changeDocument(lspUri, augmentedDocument(uri, bodyText))
    },

    detachPou(uri) {
      // Mirror of attachPou: close the document, then remove the
      // file from pyright's in-memory FS so the workspace member
      // count returns to zero when no Python POU is open.
      const lspUri = lspUriFor(uri)
      sharedService.closeDocument(lspUri)
      void pyrightConnection?.sendNotification('pyright/deleteFile', { kind: 'delete', uri: lspUri })
      entryByUri.delete(uri)
      deleteBodyLineOffset(lspUri)
    },

    dispose() {
      sharedService.dispose()
      entryByUri.clear()
    },
  }
}

export type { PythonLspService, PythonLspStartOptions } from './types'
