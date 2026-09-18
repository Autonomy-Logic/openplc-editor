// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Recover the member-access chain the cursor sits at the end of.
 *
 * Monaco's `getWordUntilPosition` stops at a `.`, which is exactly right for
 * sizing the range a completion replaces and useless for deciding *what* is
 * being completed: at `m.Gear.rat` it reports `rat`, with no indication that it
 * hangs off `m.Gear`. Scanning the line backwards over the characters a member
 * path may contain recovers the whole expression, which is what the LSP needs
 * as its anchor.
 */

/**
 * Characters a member path can contain, anchored to the end of the line.
 *
 * `[` and `]` are included so an array element (`bank[1].`) survives the scan
 * and reaches the LSP intact. Everything else — whitespace, operators,
 * parentheses, commas — terminates the chain, which is what keeps `foo(bar.`
 * anchored on `bar.` rather than on the call, and `a + b.` on `b.`.
 *
 * The first character must not be a digit: a path starts at an identifier, and
 * without that guard `1.5` in `x = 1.5` would scan as a chain rooted at `1`.
 */
const MEMBER_CHAIN_AT_END = /[A-Za-z_][A-Za-z0-9_.[\]]*$/

/**
 * The member-access chain immediately before the cursor, or `''` when the
 * cursor is not at the end of one.
 *
 * @param lineBeforeCursor - the current line's text up to the cursor column.
 */
export function memberChainBefore(lineBeforeCursor: string): string {
  const match = MEMBER_CHAIN_AT_END.exec(lineBeforeCursor)
  return match ? match[0] : ''
}
