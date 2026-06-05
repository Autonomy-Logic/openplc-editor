// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Monaco-side adapter for the shared Python LSP service.
 *
 * The service itself lives in `src/frontend/services/python-lsp/`
 * and owns the worker, the LSP handshake, and the preamble-aware
 * coordinate translation.  This file is a thin layer between the
 * Monaco editor instance the user is currently looking at and that
 * global service.
 *
 * Responsibilities:
 *
 *   - Lazy-init the service on first attach (one worker per app,
 *     not per editor).
 *   - Wire Monaco's `onDidChangeContent` per editor model so
 *     keystrokes flow through the service as didChange notifications.
 *   - Bookkeep `pouName → modelUri` so the variables-table watcher
 *     can hand `notifyVariablesChange()` the right URI when the
 *     project store fires a variable update.
 *
 * Lifecycle ownership: the service lives for the app's lifetime;
 * individual POU tabs only attach / detach.  Closing the last
 * Python tab does not tear down the worker — the next open is
 * cheaper.
 */

import { type PythonLspService, startPythonLsp } from '@root/frontend/services/python-lsp'
import type { PLCVariable } from '@root/middleware/shared/ports/types'
import type { editor as MonacoEditor, IDisposable } from 'monaco-editor'
import type * as monaco from 'monaco-editor'

let service: PythonLspService | null = null
let monacoApi: typeof monaco | null = null
let configuredWorkerUrl: string | null = null

interface EditorWiring {
  pouName: string
  contentSubscription: IDisposable
}

/** Per-URI wiring (the Monaco model the user is editing). */
const wiringByUri = new Map<string, EditorWiring>()

/**
 * Register the basedpyright worker bundle URL.  Each platform's
 * `App.tsx` resolves the URL with its own bundler (`?url` import
 * on Vite, the same on webpack 5 with `asset/resource`) and calls
 * this at app startup — the shared service intentionally has no
 * in-module fallback, see PythonLspStartOptions.workerUrl.
 *
 * `initPythonLSP` is a no-op until this has been called.  The
 * setter races with module evaluation, not with user interaction:
 * by the time the workspace mounts and Monaco fires its `onMount`
 * (where `initPythonLSP` runs), App.tsx has already resolved the
 * URL string and registered it here.
 */
export function setPythonLspWorkerUrl(url: string): void {
  configuredWorkerUrl = url
}

/**
 * Lazy-initialise the Python LSP service.  Safe to call from every
 * Monaco mount; subsequent calls are no-ops.  Logs (but doesn't
 * throw) when the worker URL hasn't been registered or the worker
 * fails to start — the editor still renders, just without
 * language-server diagnostics or completions.
 */
export async function initPythonLSP(monacoModule: typeof monaco): Promise<void> {
  if (service) return
  if (!configuredWorkerUrl) {
    console.warn('[python-lsp] worker URL not registered; LSP will not start. Call setPythonLspWorkerUrl from App.tsx.')
    return
  }
  monacoApi = monacoModule
  service = startPythonLsp({ workerUrl: configuredWorkerUrl, monaco: monacoModule })
  try {
    await service.ready
  } catch (err) {
    console.warn('[python-lsp] init failed:', err instanceof Error ? err.message : err)
  }
}

/**
 * Attach an editor's Monaco model to the LSP.  Generates the
 * preamble from `variables`, opens the document, and wires
 * `onDidChangeContent` so each keystroke flows through to Pyright
 * via `notifyBodyChange`.
 */
export function setupPythonLSPForEditor(
  editor: MonacoEditor.IStandaloneCodeEditor,
  ctx: { pouName: string; variables: PLCVariable[] },
): void {
  if (!service) return
  const model = editor.getModel()
  if (!model) return

  const uri = model.uri.toString()
  // Replace any previous wiring for this URI — happens on tab
  // close + reopen of the same POU.  The service's `attachPou`
  // would otherwise re-open an already-open document; the
  // shared layer's didOpen sequence handles this idempotently
  // (Pyright sees the same URI twice in a row), but the
  // duplicated Monaco subscription would post the same change
  // twice on every keystroke.
  wiringByUri.get(uri)?.contentSubscription.dispose()

  service.attachPou(uri, ctx.pouName, ctx.variables, model.getValue())

  const contentSubscription = model.onDidChangeContent(() => {
    service?.notifyBodyChange(uri, model.getValue())
  })

  wiringByUri.set(uri, { pouName: ctx.pouName, contentSubscription })
}

/**
 * The variables table changed: regenerate the preamble for the
 * affected POU's open editor (if any) and push the new augmented
 * document so Pyright sees the updated globals.  No-op if no editor
 * is currently attached for the POU.
 */
export function updatePythonLspContext(pouName: string, variables: PLCVariable[]): void {
  if (!service || !monacoApi) return
  for (const [uri, wiring] of wiringByUri.entries()) {
    if (wiring.pouName !== pouName) continue
    const model = monacoApi.editor.getModels().find((m) => m.uri.toString() === uri)
    if (!model) continue
    service.notifyVariablesChange(uri, variables, model.getValue())
  }
}

/**
 * Tear down the per-editor wiring for a given POU.  Called on tab
 * close.  Service itself remains alive — see module header.
 */
export function cleanupPythonLSP(pouName?: string): void {
  if (!service) return
  if (pouName) {
    // Detach only the wiring(s) for this POU.
    for (const [uri, wiring] of [...wiringByUri.entries()]) {
      if (wiring.pouName !== pouName) continue
      wiring.contentSubscription.dispose()
      service.detachPou(uri)
      wiringByUri.delete(uri)
    }
    return
  }
  // No POU specified: detach everything we tracked.  Used during
  // hot-reload / forced reset paths; not the common case.
  for (const [uri, wiring] of wiringByUri.entries()) {
    wiring.contentSubscription.dispose()
    service.detachPou(uri)
  }
  wiringByUri.clear()
}
