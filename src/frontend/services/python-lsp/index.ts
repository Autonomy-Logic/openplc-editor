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

import { generatePythonLspPreamble, type PythonLspPreamble } from '../../utils/python/generatePythonLspPreamble'
import {
  deleteBodyLineOffset,
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

const EMPTY_PREAMBLE: PythonLspPreamble = { text: '', lineCount: 0 }

export function startPythonLsp(opts: PythonLspStartOptions = {}): PythonLspService {
  const { monaco: monacoApi, workerUrlOverride, onCrash } = opts

  // Resolve the worker URL.  The require lives inside the function
  // so the bundler probe never runs under test (jsdom test envs
  // don't ship the worker asset).
  let workerUrl = workerUrlOverride
  if (!workerUrl) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const moduleExports = require('browser-basedpyright/dist/pyright.worker.js?url') as { default: string } | string
    workerUrl = typeof moduleExports === 'string' ? moduleExports : moduleExports.default
  }

  // Per-URI registry.  `preamble` is what Pyright sees concatenated
  // with the user body; `pouName` is what the Go to Definition
  // redirect hands to `routeToPouPreamble` / `routeToPouBody` so
  // those helpers can open the right tab.  Both arrive together
  // via `attachPou` and stay in sync until `detachPou`.
  //
  // Document versions are owned by the shared service — calling
  // `changeDocument` without an explicit version lets it advance
  // the same counter `openDocument` started, so LSP versions are
  // monotonically increasing across the whole attach → change →
  // change → close lifecycle.  Pyright silently drops didChange
  // notifications whose version isn't strictly greater than the
  // last one seen for that URI, so it's important that our first
  // didChange does not collide with the version=1 didOpen used.
  interface UriEntry {
    pouName: string
    preamble: PythonLspPreamble
  }
  const entryByUri = new Map<string, UriEntry>()

  function augmentedDocument(uri: string, body: string): string {
    const preamble = entryByUri.get(uri)?.preamble ?? EMPTY_PREAMBLE
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

    // No URI rewriting needed — Python POUs have one body model
    // each, and the model URI IS the LSP URI.  The default
    // resolveLspContext reads the offset from the shared registry
    // (populated by attachPou / notifyVariablesChange below).
    // No formatting filter — Pyright doesn't emit edits in the
    // preamble region, but the default still drops anything that
    // would, which is the safe behaviour.
    // Default semantic-tokens viewport: `[lineOffset, +∞)`.

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
        const sourceUri = model.uri.toString()
        const entry = entryByUri.get(sourceUri)

        // Try the store redirect first.  If any location is in the
        // source URI's preamble or body, route through the store —
        // the redirect handles the variables-panel code-mode
        // switch + cursor placement uniformly with ST.
        if (entry) {
          for (const loc of locations) {
            const handled = redirectPythonDefinitionToStore(loc, {
              sourceUri,
              sourcePouName: entry.pouName,
            })
            if (handled) return suppressNoDefinitionFound(model, position, monacoApi)
          }
        }

        // Nothing redirectable.  Fall back to filtering out targets
        // Monaco can't open (typeshed stubs, external imports).
        const navigable = locations.filter((loc) =>
          monacoApi.editor.getModels().some((m) => m.uri.toString() === loc.uri),
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
    initializationOptions: {
      files: {
        '/pyrightconfig.json': JSON.stringify({
          typeshedPath: '/typeshed',
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

    ...(onCrash ? { onCrash } : {}),
  })

  return {
    ready: sharedService.ready,

    attachPou(uri, pouName, variables, bodyText) {
      const preamble = generatePythonLspPreamble(variables)
      entryByUri.set(uri, { pouName, preamble })
      setBodyLineOffset(uri, preamble.lineCount)
      sharedService.openDocument(uri, augmentedDocument(uri, bodyText))
    },

    notifyBodyChange(uri, bodyText) {
      sharedService.changeDocument(uri, augmentedDocument(uri, bodyText))
    },

    notifyVariablesChange(uri, variables, bodyText) {
      // Variables changed: regenerate the preamble and update the
      // offset registry BEFORE pushing the new document so the
      // diagnostics callback (which fires on the next round-trip)
      // reads the new offset rather than the stale one.  Preserve
      // the recorded pouName — a pure variables edit doesn't
      // change the POU's identity.
      const existing = entryByUri.get(uri)
      const preamble = generatePythonLspPreamble(variables)
      entryByUri.set(uri, { pouName: existing?.pouName ?? '', preamble })
      setBodyLineOffset(uri, preamble.lineCount)
      sharedService.changeDocument(uri, augmentedDocument(uri, bodyText))
    },

    detachPou(uri) {
      sharedService.closeDocument(uri)
      entryByUri.delete(uri)
      deleteBodyLineOffset(uri)
    },

    dispose() {
      sharedService.dispose()
      entryByUri.clear()
    },
  }
}

export type { PythonLspService, PythonLspStartOptions } from './types'
