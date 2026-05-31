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
import { deleteBodyLineOffset, type LanguageService, setBodyLineOffset, startLanguageService } from '../lsp-shared'
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

  // Per-URI preamble registry.  Pyright sees `preamble.text + body`;
  // this map lets `notifyBodyChange` (which doesn't carry the
  // variables list) reuse the preamble that `attachPou` /
  // `notifyVariablesChange` last installed.
  //
  // Document versions are owned by the shared service — calling
  // `changeDocument` without an explicit version lets it advance
  // the same counter `openDocument` started, so LSP versions are
  // monotonically increasing across the whole attach → change →
  // change → close lifecycle.  Pyright silently drops didChange
  // notifications whose version isn't strictly greater than the
  // last one seen for that URI, so it's important that our first
  // didChange does not collide with the version=1 didOpen used.
  const preambleByUri = new Map<string, PythonLspPreamble>()

  function augmentedDocument(uri: string, body: string): string {
    const preamble = preambleByUri.get(uri) ?? EMPTY_PREAMBLE
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
    // No definition interceptors — Python LSP doesn't (yet) route
    // through the project store the way ST does.
    // No formatting filter — Pyright doesn't emit edits in the
    // preamble region, but the default still drops anything that
    // would, which is the safe behaviour.
    // Default semantic-tokens viewport: `[lineOffset, +∞)`.

    markerOwner: MARKER_OWNER,
    diagnosticSource: DIAGNOSTIC_SOURCE,

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

    attachPou(uri, variables, bodyText) {
      const preamble = generatePythonLspPreamble(variables)
      preambleByUri.set(uri, preamble)
      setBodyLineOffset(uri, preamble.lineCount)
      // DEBUG: surface the augmented document we're about to push.
      console.log('[python-lsp][debug] attachPou', {
        uri,
        preambleLineCount: preamble.lineCount,
        preambleHead: preamble.text.slice(0, 200),
        bodyLength: bodyText.length,
      })
      sharedService.openDocument(uri, augmentedDocument(uri, bodyText))
    },

    notifyBodyChange(uri, bodyText) {
      // DEBUG: confirm Monaco onDidChangeContent → service hop.
      console.log('[python-lsp][debug] notifyBodyChange', { uri, bodyLength: bodyText.length })
      sharedService.changeDocument(uri, augmentedDocument(uri, bodyText))
    },

    notifyVariablesChange(uri, variables, bodyText) {
      // Variables changed: regenerate the preamble and update the
      // offset registry BEFORE pushing the new document so the
      // diagnostics callback (which fires on the next round-trip)
      // reads the new offset rather than the stale one.
      const preamble = generatePythonLspPreamble(variables)
      preambleByUri.set(uri, preamble)
      setBodyLineOffset(uri, preamble.lineCount)
      sharedService.changeDocument(uri, augmentedDocument(uri, bodyText))
    },

    detachPou(uri) {
      sharedService.closeDocument(uri)
      preambleByUri.delete(uri)
      deleteBodyLineOffset(uri)
    },

    dispose() {
      sharedService.dispose()
      preambleByUri.clear()
    },
  }
}

export type { PythonLspService, PythonLspStartOptions } from './types'
