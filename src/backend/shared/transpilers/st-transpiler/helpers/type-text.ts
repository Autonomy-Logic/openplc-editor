/**
 * PLCOpen varlist localName → IEC 61131-3 declaration keyword.
 * Identical to the python oracle's `varTypeNames` constant
 * (`PLCGenerator.py:38`).  Used by the POU wrap to choose the right
 * `VAR_*` keyword per variable class.
 */

export const varTypeNames: Readonly<Record<string, string>> = {
  localVars: 'VAR',
  tempVars: 'VAR_TEMP',
  inputVars: 'VAR_INPUT',
  outputVars: 'VAR_OUTPUT',
  inOutVars: 'VAR_IN_OUT',
  externalVars: 'VAR_EXTERNAL',
  globalVars: 'VAR_GLOBAL',
  accessVars: 'VAR_ACCESS',
}
