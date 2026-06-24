// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * STruC++ LSP service orchestrator.
 *
 * Thin adapter over `lsp-shared/startLanguageService`.  The shared
 * layer owns the worker + jsonrpc transport, the LSP handshake,
 * Monaco provider registration, the diagnostics-to-markers pipe,
 * and the semantic-tokens registration.  This file supplies the
 * ST-specific configuration:
 *
 *   - Worker URL resolution (`strucpp/dist/browser-server.js?url`
 *     under webpack; injected for tests).
 *   - Provider hooks: the `pouvars://` URI rewrite (variables-text
 *     view targets a different LSP doc than its Monaco model);
 *     definition redirects to the Zustand store / graphical
 *     editor.
 *   - Diagnostics mirror onto the `pouvars://` model so var-block
 *     errors surface in the variables editor too.
 *   - Semantic-tokens viewport clip for the variables-text view.
 *   - The `strucpp/loadStlibBuffer` custom RPC + post-initialize
 *     stlib push, plus the public `refreshStlibs()` method.
 *
 * Lifetime is the application's lifetime; started once at boot,
 * disposed only at shutdown.
 */

import {
  type CompletionItem as LspCompletionItem,
  type CompletionList,
  CompletionRequest,
  type Diagnostic,
  type Location as LspLocation,
  type MessageConnection,
} from 'vscode-languageserver-protocol'

import { openPLCStoreBase } from '../../store'
import { serializePouScopeForQuery } from '../../utils/PLC/pou-signature-serializer'
import {
  getBodyLineOffset,
  type LanguageService,
  type LspContext,
  lspDiagnosticToMonaco,
  startLanguageService,
  suppressNoDefinitionFound,
} from '../lsp-shared'
import { parseScopedCompletionType } from './completion-type'
import { redirectDefinitionToStore } from './goto-definition-redirect'
import { redirectToGraphicalPou } from './graphical-redirect'
import { registerScopedQueryApi, type ScopedCompletionItem } from './scoped-query'
import {
  parsePouUri,
  parsePouVarsUri,
  POU_DECLARATION_LINE_COUNT,
  pouUri,
  pouVarsUri,
  type StLspService,
  type StLspStartOptions,
  stubUri,
} from './types'

const ST_LANGUAGE_ID = 'st'
const ST_WORKER_NAME = 'strucpp-lsp'
const MARKER_OWNER = 'strucpp-lsp'
const DIAGNOSTIC_SOURCE = 'strucpp'

/**
 * Custom RPC matching `LoadStlibBufferRequestType` in
 * strucpp/vscode-extension/server/src/server-browser.ts.
 */
const LOAD_STLIB_BUFFER = 'strucpp/loadStlibBuffer'

interface LoadStlibBufferParams {
  sourceLabel: string
  payload: string | { type: 'buffer'; bytes: number[] }
}

/**
 * Resolve a Monaco model URI to the LSP URI + body-line offset:
 *
 *   - `pou://<name>.st` (body editor): URI passes through; offset
 *     is whatever project-sync registered (preamble line count).
 *   - `pouvars://<name>.st` (variables text view): the LSP doesn't
 *     index this URI — remap to the live document.  For ST POUs
 *     that's `pou://`; for graphical/hybrid POUs it's `stub://`.
 *     Either way the declaration is a single line at LSP index 0,
 *     so the offset is a constant 1.
 *   - Anything else: pass through unchanged.
 */
function resolveStLspContext(modelUri: string): LspContext {
  const varsPou = parsePouVarsUri(modelUri)
  if (varsPou !== null) {
    const pou = openPLCStoreBase.getState().project.data.pous.find((p) => p.name === varsPou)
    const isStLanguage = pou?.body.language === 'st'
    const lspUri = isStLanguage ? pouUri(varsPou) : stubUri(varsPou)
    return { lspUri, lineOffset: POU_DECLARATION_LINE_COUNT }
  }
  return { lspUri: modelUri, lineOffset: getBodyLineOffset(modelUri) }
}

export function startStLsp(opts: StLspStartOptions): StLspService {
  const { stlibSource, monaco: monacoApi, workerUrlOverride, onCrash } = opts

  // Resolve the worker URL.  The require lives inside the function
  // so the bundler probe never runs under test (jsdom test envs
  // don't ship the asset).
  let workerUrl = workerUrlOverride
  if (!workerUrl) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const moduleExports = require('strucpp/dist/browser-server.js?url') as { default: string } | string
    workerUrl = typeof moduleExports === 'string' ? moduleExports : moduleExports.default
  }

  let serviceConnection: MessageConnection | null = null

  const sharedService: LanguageService = startLanguageService({
    languageId: ST_LANGUAGE_ID,
    workerName: ST_WORKER_NAME,
    workerUrl,
    ...(monacoApi ? { monaco: monacoApi } : {}),

    // Provider configuration
    completionTriggerCharacters: ['.', ':'],
    signatureHelpTriggerCharacters: ['(', ','],
    resolveLspContext: resolveStLspContext,
    definitionInterceptors: monacoApi
      ? [
          // Reroute graphical-POU stubs to the graphical editor.
          (locations: LspLocation[], model, position) => {
            const stubLocation = locations.find((l) => redirectToGraphicalPou(l.uri))
            if (stubLocation) return suppressNoDefinitionFound(model, position, monacoApi)
            return undefined
          },
          // Route variable-declaration and cross-POU targets through
          // the Zustand store.
          (locations, model, position) => {
            const primary = locations[0]
            if (primary && redirectDefinitionToStore(primary)) {
              return suppressNoDefinitionFound(model, position, monacoApi)
            }
            return undefined
          },
        ]
      : [],

    // Rename intentionally not configured.  Default capabilities
    // advertise prepareSupport, but no Monaco rename provider is
    // registered — see comment in `lsp-shared/providers.ts`.

    // Semantic-tokens viewport: variables-text view clips to the
    // VAR-block region; body editors keep everything from the
    // body line onwards.
    resolveSemanticTokensViewport: (lspUri, modelUri, lineOffset) => {
      const isVarsView = parsePouVarsUri(modelUri) !== null
      return {
        startLine: lineOffset,
        endLineExclusive: isVarsView ? getBodyLineOffset(lspUri) : Number.POSITIVE_INFINITY,
      }
    },

    // Diagnostics configuration
    markerOwner: MARKER_OWNER,
    diagnosticSource: DIAGNOSTIC_SOURCE,
    diagnosticsMirror: (params, ctx) => {
      // Mirror VAR-block diagnostics onto the variables-text editor
      // for the same POU (if mounted).  The variables editor uses a
      // separate Monaco model under `pouvars://<name>.st`; strucpp
      // doesn't publish against that URI directly, so we filter the
      // body-doc diagnostics down to the VAR region and re-emit
      // them shifted to the declaration-line frame.
      const parsed = parsePouUri(params.uri)
      if (!parsed) return
      const varsModel = ctx.monacoApi.editor.getModels().find((m) => m.uri.toString() === pouVarsUri(parsed.name))
      if (!varsModel) return
      const varDiagnostics: Diagnostic[] = params.diagnostics.filter(
        (d) => d.range.start.line >= POU_DECLARATION_LINE_COUNT && d.range.start.line < ctx.bodyOffset,
      )
      ctx.monacoApi.editor.setModelMarkers(
        varsModel,
        ctx.markerOwner,
        varDiagnostics.map((d) =>
          lspDiagnosticToMonaco(d, ctx.monacoApi, POU_DECLARATION_LINE_COUNT, ctx.defaultSource),
        ),
      )
    },

    // Lifecycle hooks
    beforeListen: (connection) => {
      serviceConnection = connection
    },
    postInitialize: async ({ connection }) => {
      await pushAllStlibs(connection)
    },
    ...(onCrash ? { onCrash } : {}),
  })

  // ---------------------------------------------------------------------------
  // Scoped completion for the graphical (LD/FBD) editors.
  //
  // Synthesize a throwaway ST doc that puts `prefix` in the POU's scope,
  // ask strucpp for completions there, and return candidates carrying
  // their resolved IEC type. A fresh URI per call avoids races between
  // concurrent queries (many variable boxes validate at once).
  // ---------------------------------------------------------------------------
  const SCOPE_QUERY_MAX_ATTEMPTS = 2
  const SCOPE_QUERY_RETRY_MS = 120
  const SCOPE_QUERY_TIMEOUT_MS = 3000
  const SCOPE_QUERY_DEFERRED_CLOSE_MS = 8000
  const SCOPE_QUERY_TIMEOUT = Symbol('scope-query-timeout')
  const SCOPE_WARMUP_POLL_MS = 500
  const SCOPE_WARMUP_MAX_POLLS = 60
  // Delay the first warm-up probe so the project-sync didOpen flood (every POU
  // stub at boot) settles first — probing the worker while it's churning those
  // is what wedges it.
  const SCOPE_WARMUP_INITIAL_DELAY_MS = 3500
  let scopeQuerySeq = 0

  // Firing a scope query while the worker is still doing its initial project
  // analysis (cold) wedges it permanently. So we gate all component-driven
  // queries behind a warm-up: a single background prober (sequential, the only
  // querier while cold) keeps trying until the worker returns results, then
  // resolves `scopeWarmReady`. `completeInScope` awaits that before touching
  // the worker, so a screenful of boxes mounting cold just parks until warm
  // instead of stampeding the cold worker.
  let resolveScopeWarmReady: () => void = () => undefined
  const scopeWarmReady = new Promise<void>((resolve) => {
    resolveScopeWarmReady = resolve
  })

  // Opening a graphical editor mounts many variable boxes that each query at
  // once. The worker is single-threaded, so we (a) coalesce identical
  // in-flight queries and (b) serialize execution to one request at a time —
  // without this, a screenful of boxes floods the worker and stalls it.
  const inFlightScopeQueries = new Map<string, Promise<ScopedCompletionItem[]>>()
  let scopeQueryTail: Promise<unknown> = Promise.resolve()

  function runScopeQuerySerialized<T>(task: () => Promise<T>): Promise<T> {
    const result = scopeQueryTail.then(task, task)
    scopeQueryTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  function normalizeCompletionItems(result: CompletionList | LspCompletionItem[] | null): ScopedCompletionItem[] {
    if (!result) return []
    const items = Array.isArray(result) ? result : result.items
    return items.map((item) => {
      const insertText =
        item.textEdit && 'newText' in item.textEdit ? item.textEdit.newText : (item.insertText ?? item.label)
      return {
        label: item.label,
        insertText,
        ...(parseScopedCompletionType(item.detail) !== undefined
          ? { type: parseScopedCompletionType(item.detail) }
          : {}),
        ...(item.kind !== undefined ? { kind: item.kind } : {}),
        ...(item.detail !== undefined ? { detail: item.detail } : {}),
      }
    })
  }

  async function requestOnce(
    connection: MessageConnection,
    uri: string,
    text: string,
    position: { line: number; character: number },
  ): Promise<ScopedCompletionItem[]> {
    sharedService.openDocument(uri, text)
    try {
      // Race against a timeout so a stalled worker request can never freeze
      // the caller (validation runs in component effects).
      const result = await Promise.race([
        connection.sendRequest(CompletionRequest.type, { textDocument: { uri }, position }),
        new Promise<typeof SCOPE_QUERY_TIMEOUT>((resolve) =>
          setTimeout(() => resolve(SCOPE_QUERY_TIMEOUT), SCOPE_QUERY_TIMEOUT_MS),
        ),
      ])
      if (result === SCOPE_QUERY_TIMEOUT) {
        // The worker is still analysing this doc — closing it now (mid-analysis)
        // wedges the worker. Defer the close until analysis has surely finished.
        setTimeout(() => sharedService.closeDocument(uri), SCOPE_QUERY_DEFERRED_CLOSE_MS)
        return []
      }
      // Completion returned → analysis settled → safe to close immediately.
      sharedService.closeDocument(uri)
      return normalizeCompletionItems(result)
    } catch {
      sharedService.closeDocument(uri)
      return []
    }
  }

  async function runScopeQuery(pouName: string, prefix: string): Promise<ScopedCompletionItem[]> {
    // Park until the worker is warm — querying it cold wedges it permanently.
    await scopeWarmReady
    const connection = serviceConnection
    if (!connection) return []
    const pou = openPLCStoreBase.getState().project.data.pous.find((p) => p.name === pouName)
    if (!pou) return []

    // Once warm, fresh per-query docs resolve instantly; a single short retry
    // covers a rare transient miss. Each attempt uses a unique URI + unique
    // synthetic POU name so docs never collide.
    for (let attempt = 0; attempt < SCOPE_QUERY_MAX_ATTEMPTS; attempt += 1) {
      const id = (scopeQuerySeq += 1)
      const { text, position } = serializePouScopeForQuery(pou, prefix, id)
      const uri = `inmemory://scopequery/${id}.st`
      const items = await requestOnce(connection, uri, text, position)
      if (items.length > 0) return items
      if (attempt < SCOPE_QUERY_MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, SCOPE_QUERY_RETRY_MS))
      }
    }
    return []
  }

  function completeInScope(pouName: string, prefix: string): Promise<ScopedCompletionItem[]> {
    const key = `${pouName} ${prefix}`
    const existing = inFlightScopeQueries.get(key)
    if (existing) return existing
    const query = runScopeQuerySerialized(() => runScopeQuery(pouName, prefix)).finally(() => {
      inFlightScopeQueries.delete(key)
    })
    inFlightScopeQueries.set(key, query)
    return query
  }

  // Background warm-up: the ONLY querier while the worker is cold. Probes a
  // real POU sequentially until it returns results, then unblocks every parked
  // component query. Resolves anyway after a bounded number of polls so the
  // feature degrades to best-effort rather than hanging forever.
  async function warmUpScopeWorker(): Promise<void> {
    try {
      await sharedService.ready
    } catch {
      resolveScopeWarmReady()
      return
    }
    const connection = serviceConnection
    if (!connection) {
      resolveScopeWarmReady()
      return
    }
    await new Promise((r) => setTimeout(r, SCOPE_WARMUP_INITIAL_DELAY_MS))
    for (let poll = 0; poll < SCOPE_WARMUP_MAX_POLLS; poll += 1) {
      const pou = openPLCStoreBase.getState().project.data.pous[0]
      if (pou) {
        const id = (scopeQuerySeq += 1)
        const { text, position } = serializePouScopeForQuery(pou, '', id)
        const uri = `inmemory://scopequery/warmup-${id}.st`
        const items = await requestOnce(connection, uri, text, position)
        if (items.length > 0) {
          resolveScopeWarmReady()
          return
        }
      }
      await new Promise((r) => setTimeout(r, SCOPE_WARMUP_POLL_MS))
    }
    resolveScopeWarmReady()
  }

  registerScopedQueryApi({ completeInScope })
  void warmUpScopeWorker()

  async function pushAllStlibs(connection: MessageConnection): Promise<void> {
    const sources = await stlibSource.listStlibs()
    // Honor the project's enabled-library set, plus the always-on
    // bundled archives.  The adapter returns every system-installed
    // archive; the project policy lives in the store.  Bundled libs
    // (e.g. the IEC standard FBs like `TON`) are tracked separately
    // in `bundledLibraryNames` and are intentionally absent from
    // `enabledLibraries`, so filtering on the latter alone would
    // starve the LSP of every standard symbol.
    const state = openPLCStoreBase.getState()
    const allowed = new Set([...state.enabledLibraries, ...state.bundledLibraryNames])
    for (const source of sources) {
      if (!allowed.has(source.name)) continue
      try {
        const payload = await stlibSource.readStlib(source.sourceLabel)
        await connection.sendRequest(LOAD_STLIB_BUFFER, {
          sourceLabel: source.sourceLabel,
          payload,
        } as LoadStlibBufferParams)
      } catch (err) {
        // One bad archive shouldn't starve the rest.  Surface
        // diagnostically — completion still works for the libraries
        // that did load.
        console.warn(`[strucpp-lsp] failed to load stlib "${source.sourceLabel}":`, err)
      }
    }
  }

  return {
    ready: sharedService.ready,

    refreshStlibs: async () => {
      try {
        await sharedService.ready
      } catch {
        return
      }
      const connection = serviceConnection
      if (!connection) return
      // Clear-then-repush so the worker's cache reflects the
      // current stlib set exactly.  Cheaper than diffing, and the
      // worker's per-archive parse is fast.
      try {
        await connection.sendRequest('strucpp/clearStlibCache')
      } catch {
        // Older worker bundles may not have this RPC yet — silent
        // fallback to "additive" semantics is acceptable.
      }
      await pushAllStlibs(connection)
    },

    openDocument(uri, content) {
      sharedService.openDocument(uri, content)
    },

    changeDocument(uri, content, externalVersion) {
      sharedService.changeDocument(uri, content, externalVersion)
    },

    closeDocument(uri) {
      sharedService.closeDocument(uri)
    },

    dispose() {
      registerScopedQueryApi(null)
      sharedService.dispose()
    },
  }
}

export { getScopedQueryApi, type ScopedCompletionItem, type ScopedQueryApi } from './scoped-query'
export type { StLspService, StLspStartOptions } from './types'
export { parsePouUri, POU_URI_SCHEME, pouUri, stubUri } from './types'
