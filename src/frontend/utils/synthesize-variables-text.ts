// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * Single source of truth for the "variables → text" rendering used
 * by both the variables-panel code-mode editor AND the Python LSP
 * preamble fed to Pyright.
 *
 * Why a single helper:
 *
 *   Before this, two different synthesizers produced two different
 *   texts for the same set of variables — `generateIecVariablesToString`
 *   emits IEC VAR_INPUT / VAR_OUTPUT blocks (the historical view
 *   the variables-code-editor was built around), and
 *   `generatePythonLspPreamble` emits Python module-level globals
 *   with annotations (what Pyright needs to recognise IEC names in
 *   a POU body).  Line numbers between the two never lined up, so
 *   any Go to Definition redirect that wanted to land in the
 *   variables-code-editor had to compute a per-POU line-mapping
 *   between the two layouts.  Hard bug to track, easy to drift.
 *
 *   This helper picks the language-appropriate synthesizer.  When
 *   the variables-code-editor uses it for a Python POU AND the
 *   Python LSP service uses the same function for its Pyright
 *   preamble, the two views are byte-identical.  Pyright reports a
 *   variable declaration at LSP line N, and that's also line N in
 *   the variables-code-editor — no shift math, no drift.
 *
 *   ST / IL / CPP POUs keep the IEC-text rendering; only Python
 *   diverges (because that's the only POU language whose LSP
 *   speaks a non-IEC syntax).
 */

import type { PLCVariable } from '../../middleware/shared/ports/types'
import { generateIecVariablesToString } from './generate-iec-variables-to-string'
import { generatePythonLspPreamble } from './python/generatePythonLspPreamble'

/**
 * `language` here is the POU body language (`'st' | 'il' | 'python'
 * | 'cpp' | 'ld' | 'sfc' | 'fbd'`).  Anything other than `'python'`
 * uses the IEC synthesizer — the existing default that ST/IL share
 * and that graphical languages reuse for their declarations
 * panel.
 *
 * Returns the text and the number of newline characters in it.
 * The line count is what callers use as an LSP body-line offset
 * (the Python LSP service registers it via `setBodyLineOffset`
 * after `attachPou`).  For the IEC path the count is informational
 * — IEC-using POUs don't drive an LSP through this synthesizer.
 */
export interface SynthesizedVariablesText {
  text: string
  lineCount: number
}

export function synthesizeVariablesText(
  variables: PLCVariable[],
  language: string | undefined,
): SynthesizedVariablesText {
  if (language === 'python') {
    return generatePythonLspPreamble(variables)
  }
  const text = generateIecVariablesToString(variables)
  // Count newlines so callers that care about offsets get a stable
  // shape regardless of which branch fired.  IEC text always ends
  // with a newline so this counts the trailing one correctly.
  const lineCount = text.split('\n').length - 1
  return { text, lineCount }
}
