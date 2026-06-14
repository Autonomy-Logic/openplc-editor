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

import type { Diagnostic, Location as LspLocation, MessageConnection } from 'vscode-languageserver-protocol'

import { openPLCStoreBase } from '../../store'
import {
  getBodyLineOffset,
  type LanguageService,
  type LspContext,
  lspDiagnosticToMonaco,
  startLanguageService,
  suppressNoDefinitionFound,
} from '../lsp-shared'
import { redirectDefinitionToStore } from './goto-definition-redirect'
import { redirectToGraphicalPou } from './graphical-redirect'
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
      sharedService.dispose()
    },
  }
}

export type { StLspService, StLspStartOptions } from './types'
export { parsePouUri, POU_URI_SCHEME, pouUri, stubUri } from './types'
