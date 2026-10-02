/**
 * A block instance that lives in a global variable list.
 *
 * The ladder and FBD block elements resolve their instance name against the
 * POU's own `interface.variables`. A global variable list member — `NET.node`,
 * the pattern the ModBee docs use so one node can be shared by a fast task and
 * the application — is not in that list under any spelling, so the block
 * painted itself with the red "wrong variable" ring while the project compiled
 * and ran perfectly.
 *
 * The lists are known to the LSP (`st-lsp/project-sync` reconciles them), which
 * is why contacts and coils on `IO.DO01` were always fine: they validate
 * through this module. This is the same question asked for a block instance.
 */

import { afterEach, describe, expect, it } from '@jest/globals'

// `graphical-scope` reaches the LSP through the `st-lsp` barrel, which pulls
// `vscode-languageserver-protocol` — ESM that jest does not transform. Every
// symbol it actually uses lives in `scoped-query`, so stand that in for the
// barrel: the real resolution logic runs, only the unreachable import goes.
jest.mock('../st-lsp', () => require('../st-lsp/scoped-query'))

import { isBlockInstanceInScope } from '../graphical-scope'
import { registerScopedQueryApi, type ScopedCompletionItem } from '../st-lsp/scoped-query'

afterEach(() => registerScopedQueryApi(null))

/** Stand in for the LSP, answering one anchor with the members it knows. */
const withScope = (byAnchor: Record<string, ScopedCompletionItem[]>) =>
  registerScopedQueryApi({
    completeInScope: (_pouName: string, prefix: string) => Promise.resolve(byAnchor[prefix] ?? []),
  })

/** Kind 6 is LSP `Variable` — what strucpp reports for an in-scope symbol. */
const member = (label: string, type: string): ScopedCompletionItem => ({
  label,
  insertText: label,
  type,
  kind: 6,
})

describe('a function-block instance held in a global variable list', () => {
  it('is in scope when the list member has the block type', async () => {
    withScope({ 'NET.': [member('node', 'NODE'), member('Level', 'REAL')] })
    await expect(isBlockInstanceInScope('RunNode', 'NET.node', 'NODE')).resolves.toBe(true)
  })

  it('matches the type without regard to case, as ST does', async () => {
    withScope({ 'NET.': [member('node', 'node')] })
    await expect(isBlockInstanceInScope('RunNode', 'NET.node', 'NODE')).resolves.toBe(true)
  })

  it('is not in scope when the member is of some other type', async () => {
    withScope({ 'NET.': [member('node', 'REAL')] })
    await expect(isBlockInstanceInScope('RunNode', 'NET.node', 'NODE')).resolves.toBe(false)
  })

  it('is not in scope when the list has no such member', async () => {
    withScope({ 'NET.': [member('Level', 'REAL')] })
    await expect(isBlockInstanceInScope('RunNode', 'NET.missing', 'NODE')).resolves.toBe(false)
  })

  it('answers for a plain local instance too', async () => {
    withScope({ '': [member('digIn', 'DIGITAL_IN')] })
    await expect(isBlockInstanceInScope('ReadInputs', 'digIn', 'DIGITAL_IN')).resolves.toBe(true)
  })
})

describe('when the LSP cannot answer', () => {
  it('says undefined rather than false, so the caller leaves the block alone', async () => {
    // No API registered at all — boot, a worker crash, or a test env.
    await expect(isBlockInstanceInScope('RunNode', 'NET.node', 'NODE')).resolves.toBeUndefined()
  })

  it('says undefined while the worker has no context yet', async () => {
    // Registered but answering empty, which the resolver treats as warming up.
    withScope({})
    await expect(isBlockInstanceInScope('RunNode', 'NET.node', 'NODE')).resolves.toBeUndefined()
  })
})
