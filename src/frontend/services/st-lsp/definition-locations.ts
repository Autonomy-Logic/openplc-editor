// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Where an ST definition target is shown before it is activated.
 *
 * A body target stays a body location: Monaco previews and jumps inside
 * the POU model as it would in any file. Everything the body editor does
 * not render — the declaration line, the VAR blocks, a stub, the
 * synthesized documents — resolves to the mirror of its document, so the
 * hover preview shows the real declaration and the opener gets the LSP
 * coordinates back untouched (`goto-definition-redirect.ts` turns them
 * into the tab, panel and cursor the user expects).
 */

import type { Location as LspLocation } from 'vscode-languageserver-protocol'

import { getBodyLineOffset } from '../lsp-shared/body-offsets'
import { lspRangeToMonaco } from '../lsp-shared/converters'
import { lspMirrorUri } from '../lsp-shared/lsp-mirror'
import type { MappedLocation } from '../lsp-shared/providers'
import {
  DATA_TYPES_URI,
  GLOBAL_VARIABLE_LISTS_URI,
  parsePouUri,
  RESOURCE_GLOBALS_URI,
  SOFTMOTION_GLOBALS_URI,
} from './types'

const SYNTHESIZED_URIS = new Set([
  DATA_TYPES_URI,
  RESOURCE_GLOBALS_URI,
  SOFTMOTION_GLOBALS_URI,
  GLOBAL_VARIABLE_LISTS_URI,
])

export function mapStDefinitionLocation(loc: LspLocation): MappedLocation {
  const parsed = parsePouUri(loc.uri)
  if (parsed?.kind === 'pou') {
    const bodyOffset = getBodyLineOffset(loc.uri)
    if (bodyOffset > 0 && loc.range.start.line >= bodyOffset) {
      return { uri: loc.uri, range: lspRangeToMonaco(loc.range, bodyOffset) }
    }
  }
  if (parsed || SYNTHESIZED_URIS.has(loc.uri)) {
    return { uri: lspMirrorUri(loc.uri), range: lspRangeToMonaco(loc.range, 0) }
  }
  return { uri: loc.uri, range: lspRangeToMonaco(loc.range, getBodyLineOffset(loc.uri)) }
}
