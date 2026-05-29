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
  const preambleByUri = new Map<string, PythonLspPreamble>()

  // Per-URI version counter.  LSP requires monotonically-increasing
  // versions on didChange; we control the doc lifecycle entirely on
  // this side, so a simple per-URI counter is sufficient.
  const versionByUri = new Map<string, number>()

  function nextVersion(uri: string): number {
    const v = (versionByUri.get(uri) ?? 0) + 1
    versionByUri.set(uri, v)
    return v
  }

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

    ...(onCrash ? { onCrash } : {}),
  })

  return {
    ready: sharedService.ready,

    attachPou(uri, variables, bodyText) {
      const preamble = generatePythonLspPreamble(variables)
      preambleByUri.set(uri, preamble)
      setBodyLineOffset(uri, preamble.lineCount)
      sharedService.openDocument(uri, augmentedDocument(uri, bodyText))
    },

    notifyBodyChange(uri, bodyText) {
      sharedService.changeDocument(uri, augmentedDocument(uri, bodyText), nextVersion(uri))
    },

    notifyVariablesChange(uri, variables, bodyText) {
      // Variables changed: regenerate the preamble and update the
      // offset registry BEFORE pushing the new document so the
      // diagnostics callback (which fires on the next round-trip)
      // reads the new offset rather than the stale one.
      const preamble = generatePythonLspPreamble(variables)
      preambleByUri.set(uri, preamble)
      setBodyLineOffset(uri, preamble.lineCount)
      sharedService.changeDocument(uri, augmentedDocument(uri, bodyText), nextVersion(uri))
    },

    detachPou(uri) {
      sharedService.closeDocument(uri)
      preambleByUri.delete(uri)
      versionByUri.delete(uri)
      deleteBodyLineOffset(uri)
    },

    dispose() {
      sharedService.dispose()
      preambleByUri.clear()
      versionByUri.clear()
    },
  }
}

export type { PythonLspService, PythonLspStartOptions } from './types'
