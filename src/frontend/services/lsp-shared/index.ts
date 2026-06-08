// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Shared LSP infrastructure for every language service in the
 * editor.  Today: ST (strucpp browser worker) and Python
 * (browser-basedpyright).  New language services should consume
 * this layer rather than reinventing the worker / jsonrpc / Monaco
 * wiring.
 */

export {
  __clearBodyLineOffsetsForTests,
  deleteBodyLineOffset,
  getBodyLineOffset,
  setBodyLineOffset,
} from './body-offsets'
export {
  lspCompletionListToMonaco,
  lspCompletionToMonaco,
  lspDiagnosticToMonaco,
  lspHoverToMonaco,
  lspLocationsToMonaco,
  lspLocationToMonaco,
  lspPositionToMonaco,
  lspRangeToMonaco,
  lspSignatureHelpToMonaco,
  lspSymbolKindToMonaco,
  lspSymbolToMonaco,
  lspTextEditToMonaco,
  monacoPositionToLsp,
  monacoRangeToLsp,
} from './converters'
export {
  type NavTarget,
  normaliseLocation,
  routeToPou,
  routeToPouBody,
  routeToPouPreamble,
} from './definition-redirect'
export {
  attachDiagnosticsBridge,
  type AttachDiagnosticsBridgeOptions,
  type DiagnosticsBridge,
  type DiagnosticsMirror,
} from './diagnostics'
export {
  type DefinitionInterceptor,
  type LspContext,
  type ProviderHooks,
  registerLspProviders,
  type RegisterLspProvidersOptions,
} from './providers'
export {
  registerLspSemanticTokens,
  type RegisterLspSemanticTokensOptions,
  type ResolveSemanticTokensViewport,
  type SemanticTokensRegistration,
} from './semantic-tokens'
export {
  DEFAULT_CLIENT_CAPABILITIES,
  type LanguageService,
  startLanguageService,
  type StartLanguageServiceOptions,
} from './start-language-service'
export { createLspTransport, type CreateLspTransportOptions, type LspTransport } from './transport'

// Internal helpers exposed for tests / specialised callers.
export { shiftSemanticTokensToBody } from './internal/semantic-tokens-shift'
export {
  lspDocumentSymbolToMonaco,
  normaliseLocationResponse,
  suppressNoDefinitionFound,
  symbolInformationToDocumentSymbol,
} from './internal/symbol-helpers'
