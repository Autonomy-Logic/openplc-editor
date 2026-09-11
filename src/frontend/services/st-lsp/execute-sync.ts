// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Execute ("ST Block") snippets → LSP document sync.
 *
 * A graphical POU's body reaches the LSP as a signature-only `stub://`
 * document, so a snippet inside an LD/FBD diagram would get no diagnostics at
 * all. Each Execute node instead gets its own synthetic document — the owning
 * POU's declarations wrapped around the snippet — which strucpp type-checks
 * like any textual ST body.
 *
 * The document URI doubles as the Monaco model URI of the node's editing
 * surface, which is what makes diagnostics attach (see `execute-st-uri.ts`).
 * `setBodyLineOffset` records the synthesized preamble's height so reported
 * lines map back onto the snippet. The shell POU carries a throwaway,
 * node-stable name so it cannot collide with the POU's real `stub://`
 * declaration, which is open at the same time.
 *
 * Diffed against a snapshot the way `project-sync` diffs POUs.
 */

import type { PLCPou } from '../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../store'
import { executeStDocumentUri, executeStScopeId, parseExecuteStDocumentUri } from '../../utils/PLC/execute-st-uri'
import { serializePouScopeForBody } from '../../utils/PLC/pou-signature-serializer'
import { deleteBodyLineOffset, setBodyLineOffset } from '../lsp-shared/body-offsets'
import type { StLspService } from './types'

/** Debounce for keystroke-driven `didChange`, in ms. */
const SYNC_DEBOUNCE_MS = 250

export interface ExecuteSyncHandle {
  dispose(): void
}

/**
 * Live-draft channel for an open Execute editor.
 *
 * The store only learns the snippet on blur, so a store-driven sync delivers
 * diagnostics a commit late. The open editor pushes its draft straight through
 * here instead. Registered the way `scoped-query.ts` registers its API:
 * module-level, null whenever the LSP is unavailable (tests, boot races,
 * worker crash) so callers degrade rather than throw.
 */
export interface ExecuteDraftApi {
  /**
   * Publish a snippet now. `force` re-sends unchanged text with a bumped
   * version so the worker re-analyses — needed because diagnostics are a
   * one-shot notification, and a model created later (the expand modal builds
   * a fresh one) would otherwise never receive markers.
   */
  syncDraft(uri: string, code: string, force?: boolean): void
}

let draftApi: ExecuteDraftApi | null = null

export function getExecuteDraftApi(): ExecuteDraftApi | null {
  return draftApi
}

type Snapshot = {
  contentByUri: Map<string, string>
}

/** One Execute node paired with the POU that owns it. */
type ExecuteDoc = {
  uri: string
  pou: PLCPou
  nodeId: string
  code: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Collect every Execute node across the project's graphical flows.
 *
 * Reads the live flow slices rather than `pou.body.value`, whose write-back is
 * debounced and can lag the canvas.
 */
export function collectExecuteDocs(state: {
  project: { data: { pous: PLCPou[] } }
  ladderFlows: Array<{ name: string; rungs: Array<{ nodes: Array<{ id: string; type?: string; data: unknown }> }> }>
  fbdFlows: Array<{ name: string; rung: { nodes: Array<{ id: string; type?: string; data: unknown }> } }>
}): ExecuteDoc[] {
  const out: ExecuteDoc[] = []
  const pouByName = new Map(state.project.data.pous.map((pou) => [pou.name, pou]))

  const visit = (pouName: string, nodes: Array<{ id: string; type?: string; data: unknown }>) => {
    const pou = pouByName.get(pouName)
    if (!pou) return
    for (const node of nodes) {
      if (node.type !== 'execute') continue
      if (!isRecord(node.data)) continue
      const code = node.data['code']
      if (typeof code !== 'string' || code.trim() === '') continue
      out.push({ uri: executeStDocumentUri(pouName, node.id), pou, nodeId: node.id, code })
    }
  }

  for (const flow of state.ladderFlows) {
    for (const rung of flow.rungs) visit(flow.name, rung.nodes)
  }
  for (const flow of state.fbdFlows) visit(flow.name, flow.rung.nodes)

  return out
}

export function attachExecuteSync(service: StLspService): ExecuteSyncHandle {
  const snapshot: Snapshot = { contentByUri: new Map() }
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | null = null

  // As `project-sync`: `AT <alias>` is not legal IEC, so the LSP must see
  // resolved literal addresses or the whole VAR block is lost.
  const aliasIndex = (): ReadonlyMap<string, string> => openPLCStoreBase.getState().projectActions.getAliasIndex()

  function reconcile(): void {
    if (disposed) return
    const state = openPLCStoreBase.getState()
    const docs = collectExecuteDocs(state)
    const seen = new Set<string>()

    for (const doc of docs) {
      seen.add(doc.uri)
      publish(doc.uri, doc.pou, doc.nodeId, doc.code)
    }

    // Close what disappeared: node deleted or emptied, POU removed or renamed
    // (a rename changes the URI, so it surfaces as a close plus an open).
    for (const uri of [...snapshot.contentByUri.keys()]) {
      if (seen.has(uri)) continue
      service.closeDocument(uri)
      snapshot.contentByUri.delete(uri)
      deleteBodyLineOffset(uri)
    }
  }

  /**
   * Publish one snippet. Shares `snapshot.contentByUri` with `reconcile`, so
   * whichever ran last owns the document and identical text is a no-op.
   */
  function publish(uri: string, pou: PLCPou, nodeId: string, code: string, force = false): void {
    if (disposed) return
    const { text, bodyLineOffset } = serializePouScopeForBody(pou, code, executeStScopeId(nodeId), aliasIndex())
    setBodyLineOffset(uri, bodyLineOffset)

    const previous = snapshot.contentByUri.get(uri)
    if (previous === undefined) {
      service.openDocument(uri, text)
    } else if (previous !== text || force) {
      // No external version: `openDocument` sets version 1, so a caller-side
      // counter starting at 1 collides on the first edit and the worker drops
      // it. Letting the service auto-increment is what that fallback is for.
      service.changeDocument(uri, text)
    } else {
      return
    }
    snapshot.contentByUri.set(uri, text)
  }

  draftApi = {
    syncDraft(uri, code, force = false) {
      const parsed = parseExecuteStDocumentUri(uri)
      if (parsed === null) return
      const pou = openPLCStoreBase.getState().project.data.pous.find((p) => p.name === parsed.pouName)
      if (!pou) return
      publish(uri, pou, parsed.nodeId, code, force)
    },
  }

  function schedule(): void {
    if (disposed) return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      reconcile()
    }, SYNC_DEBOUNCE_MS)
  }

  // Selector-scoped, matching `project-sync` — a blanket subscribe would fire
  // on every store write, including each debug poll tick. Three triggers: the
  // flows carry the snippet text, the POU list carries the declarations the
  // shell embeds, and the alias index changes on a pure re-address.
  const unsubscribeLadder = openPLCStoreBase.subscribe((state) => state.ladderFlows, schedule)
  const unsubscribeFbd = openPLCStoreBase.subscribe((state) => state.fbdFlows, schedule)
  const unsubscribePous = openPLCStoreBase.subscribe((state) => state.project.data.pous, schedule)
  const unsubscribeAliases = openPLCStoreBase.subscribe((state) => state.projectActions.getAliasIndex(), schedule)
  const unsubscribe = () => {
    unsubscribeAliases()
    unsubscribePous()
    unsubscribeFbd()
    unsubscribeLadder()
  }

  return {
    dispose() {
      disposed = true
      draftApi = null
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      unsubscribe()
      for (const uri of snapshot.contentByUri.keys()) {
        service.closeDocument(uri)
        deleteBodyLineOffset(uri)
      }
      snapshot.contentByUri.clear()
    },
  }
}
