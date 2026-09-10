// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * A Monaco model per LSP document, under a URI of its own.
 *
 * Monaco resolves a definition target through its model service: the
 * Ctrl+hover preview reads the target line from a model, and the peek
 * widget embeds one. The documents the workers analyse had no such model
 * — a body editor renders a slice of its POU document, and the synthesized
 * documents (data types, globals, axes) have no editor at all — so a target
 * inside them had nowhere to resolve. The mirror gives every LSP document
 * a plaintext model holding the exact text the worker saw. Plaintext, so
 * no language provider ever runs against it; the preview still colours by
 * the URI's extension. Navigating to it goes through the editor opener
 * (`navigation.ts`), never through Monaco's own in-model jump.
 */

import type * as monaco from 'monaco-editor'

const MIRROR_PREFIX = 'inmemory://lsp-mirror/'

/** `inmemory://pou/main.st` → `inmemory://lsp-mirror/inmemory/pou/main.st`. */
export function lspMirrorUri(lspUri: string): string {
  return `${MIRROR_PREFIX}${lspUri.replace('://', '/')}`
}

/** Inverse of {@link lspMirrorUri}; null for any other URI. */
export function parseLspMirrorUri(uri: string): string | null {
  if (!uri.startsWith(MIRROR_PREFIX)) return null
  const rest = uri.slice(MIRROR_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return null
  return `${rest.slice(0, slash)}://${rest.slice(slash + 1)}`
}

export interface LspDocumentMirror {
  /** The document was opened or changed; the mirror holds `text` from now on. */
  set(lspUri: string, text: string): void
  /** The document was closed. */
  delete(lspUri: string): void
  dispose(): void
}

export function createLspDocumentMirror(monacoApi: typeof monaco): LspDocumentMirror {
  const models = new Map<string, monaco.editor.ITextModel>()
  return {
    set(lspUri, text) {
      const uri = monacoApi.Uri.parse(lspMirrorUri(lspUri))
      const model =
        models.get(lspUri) ?? monacoApi.editor.getModel(uri) ?? monacoApi.editor.createModel(text, 'plaintext', uri)
      if (model.getValue() !== text) model.setValue(text)
      models.set(lspUri, model)
    },
    delete(lspUri) {
      models.get(lspUri)?.dispose()
      models.delete(lspUri)
    },
    dispose() {
      for (const model of models.values()) model.dispose()
      models.clear()
    },
  }
}
