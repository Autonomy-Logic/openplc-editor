/**
 * An array element named by a contact, a coil or a variable box.
 *
 * IEC 61131-3 Ed 3 §8.1.2 shows both spellings on an LD contact —
 *
 *     Xs[3]   "as an array element with constant subscript"
 *     Xs[i]   "as an array element with variable subscript"
 *
 * — under "All supported data types SHALL be accessible as operands or
 * parameters in the graphical languages". §6.4.4.5.1 narrows what a subscript
 * may be in a graphical language: "single-element variables or integer
 * literals", nothing computed.
 *
 * The constant form resolves through the language server, which publishes one
 * symbol per in-bounds element. That is what makes `Xs[99]` flag itself, and
 * it must keep doing so.
 *
 * The variable form has no such symbol and never could, so it is resolved
 * here. §6.4.4.5.1's own note says the bounds cannot be checked anyway:
 * "This error can be detected only at runtime for a computed index."
 */

import { afterEach, describe, expect, it } from '@jest/globals'

jest.mock('../st-lsp', () => require('../st-lsp/scoped-query'))

import { isExpressionValidForType, resolveScopeExpressionType } from '../graphical-scope'
import { registerScopedQueryApi, type ScopedCompletionItem } from '../st-lsp/scoped-query'

afterEach(() => registerScopedQueryApi(null))

/** Kind 6 is LSP `Variable` — what strucpp reports for an in-scope symbol. */
const member = (label: string, type: string): ScopedCompletionItem => ({
  label,
  insertText: label,
  type,
  kind: 6,
})

const withScope = (byAnchor: Record<string, ScopedCompletionItem[]>) =>
  registerScopedQueryApi({
    completeInScope: (_pouName: string, prefix: string) => Promise.resolve(byAnchor[prefix] ?? []),
  })

/** A POU holding a 1-D BOOL array, a 2-D INT array, and some subscripts. */
const LOCALS: ScopedCompletionItem[] = [
  member('bits', 'ARRAY [0..3] OF BOOL'),
  member('bits[0]', 'BOOL'),
  member('bits[1]', 'BOOL'),
  member('bits[2]', 'BOOL'),
  member('bits[3]', 'BOOL'),
  member('grid', 'ARRAY [0..1, 0..1] OF INT'),
  member('grid[0,0]', 'INT'),
  member('grid[0,1]', 'INT'),
  member('grid[1,0]', 'INT'),
  member('grid[1,1]', 'INT'),
  member('i', 'INT'),
  member('j', 'DINT'),
  member('ratio', 'REAL'),
  member('flag', 'BOOL'),
]

describe('an array element with a constant subscript', () => {
  it('resolves to the element type', async () => {
    withScope({ '': LOCALS })
    await expect(resolveScopeExpressionType('P', 'bits[2]')).resolves.toEqual({
      status: 'resolved',
      type: 'BOOL',
    })
  })

  it('stays flagged when the index is out of bounds', async () => {
    withScope({ '': LOCALS })
    await expect(resolveScopeExpressionType('P', 'bits[99]')).resolves.toEqual({ status: 'unknown' })
  })
})

describe('an array element with a variable subscript', () => {
  it('resolves to the element type — §8.1.2, "variable subscript"', async () => {
    withScope({ '': LOCALS })
    await expect(resolveScopeExpressionType('P', 'bits[i]')).resolves.toEqual({
      status: 'resolved',
      type: 'BOOL',
    })
  })

  it('is therefore usable on a BOOL contact', async () => {
    withScope({ '': LOCALS })
    await expect(isExpressionValidForType('P', 'bits[i]', 'BOOL')).resolves.toBe(true)
  })

  it('takes any ANY_INT subscript, not only INT', async () => {
    withScope({ '': LOCALS })
    await expect(resolveScopeExpressionType('P', 'bits[j]')).resolves.toEqual({
      status: 'resolved',
      type: 'BOOL',
    })
  })

  it('works on each dimension of a multi-dimensional array', async () => {
    withScope({ '': LOCALS })
    for (const expr of ['grid[i,0]', 'grid[0,i]', 'grid[i,j]']) {
      await expect(resolveScopeExpressionType('P', expr)).resolves.toEqual({
        status: 'resolved',
        type: 'INT',
      })
    }
  })

  it('refuses a subscript that is not an integer — §6.4.4.5.1', async () => {
    withScope({ '': LOCALS })
    await expect(resolveScopeExpressionType('P', 'bits[ratio]')).resolves.toEqual({ status: 'unknown' })
    await expect(resolveScopeExpressionType('P', 'bits[flag]')).resolves.toEqual({ status: 'unknown' })
  })

  it('refuses a subscript that is not in scope at all', async () => {
    withScope({ '': LOCALS })
    await expect(resolveScopeExpressionType('P', 'bits[nosuch]')).resolves.toEqual({ status: 'unknown' })
  })

  it('refuses the wrong number of subscripts for the array', async () => {
    withScope({ '': LOCALS })
    await expect(resolveScopeExpressionType('P', 'bits[i,j]')).resolves.toEqual({ status: 'unknown' })
    await expect(resolveScopeExpressionType('P', 'grid[i]')).resolves.toEqual({ status: 'unknown' })
  })

  it('refuses a subscript on something that is not an array', async () => {
    withScope({ '': LOCALS })
    await expect(resolveScopeExpressionType('P', 'ratio[i]')).resolves.toEqual({ status: 'unknown' })
  })
})

describe('an array element of a global variable list member', () => {
  // A list compiles to a STRUCT, so this is the `LIST.member[i]` path — the one
  // the RS-485 rig uses for everything arriving off the bus.
  const NET: ScopedCompletionItem[] = [
    member('P20Di', 'ARRAY [0..7] OF BOOL'),
    member('P20Di[0]', 'BOOL'),
    member('P20Di[1]', 'BOOL'),
    member('idx', 'INT'),
  ]

  it('resolves a constant subscript', async () => {
    withScope({ 'NET.': NET, '': LOCALS })
    await expect(resolveScopeExpressionType('P', 'NET.P20Di[1]')).resolves.toEqual({
      status: 'resolved',
      type: 'BOOL',
    })
  })

  it('takes a subscript from the POU, not from the list', async () => {
    // `i` in `NET.P20Di[i]` is a variable of the POU. Looking it up under the
    // list's anchor would ask for `NET.i`, which does not exist.
    withScope({ 'NET.': NET, '': LOCALS })
    await expect(resolveScopeExpressionType('P', 'NET.P20Di[i]')).resolves.toEqual({
      status: 'resolved',
      type: 'BOOL',
    })
  })

  it('also takes a subscript written out as a list member', async () => {
    withScope({ 'NET.': NET, '': LOCALS })
    await expect(resolveScopeExpressionType('P', 'NET.P20Di[NET.idx]')).resolves.toEqual({
      status: 'resolved',
      type: 'BOOL',
    })
  })

  it('does not mistake a dot inside a subscript for a member chain', async () => {
    // `splitExpression` used to cut at the last dot wherever it was, making
    // the anchor `NET.P20Di[NET.` — which could never resolve.
    withScope({ 'NET.': NET, '': LOCALS })
    await expect(resolveScopeExpressionType('P', 'NET.P20Di[NET.nosuch]')).resolves.toEqual({
      status: 'unknown',
    })
  })
})

describe('while the language server is still warming up', () => {
  it('does not paint a false error', async () => {
    withScope({})
    await expect(resolveScopeExpressionType('P', 'bits[i]')).resolves.toEqual({ status: 'unavailable' })
    await expect(isExpressionValidForType('P', 'bits[i]', 'BOOL')).resolves.toBe(true)
  })
})
