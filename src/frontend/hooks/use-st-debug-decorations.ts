/**
 * Inline debug-value badges for a Structured Text Monaco surface.
 *
 * During a debug session every occurrence of a live variable in the
 * source gets an ` = <value>` badge rendered after it. The mechanism is
 * purely name-based: the debug store keys values by
 * `<prefix><variableName>`, so decorating is a matter of finding those
 * names in the text and attaching an `after` decoration.
 *
 * Extracted from the POU-level Monaco editor so the graphical Execute
 * ("ST Block") element gets identical badges without duplicating the
 * scanner. The POU editor supplies its own prefix (`<pouName>:`, or an
 * instance-qualified one for function blocks); the Execute field
 * supplies the prefix of the POU that owns it.
 *
 * Comments are stripped before scanning so a variable named in a
 * comment doesn't collect a badge.
 */

import type * as monaco from 'monaco-editor'
import { type RefObject, useEffect, useMemo } from 'react'

import { useDebugBoolValuesMap, useDebugNonBoolValuesMap } from './use-debug-value'

type BlockCommentState = false | 'paren' | 'slash'

/**
 * Blank out comment spans in a single line, carrying block-comment
 * state across lines. Characters are replaced with spaces rather than
 * removed so column positions stay aligned with the real line.
 *
 * ST has two block-comment forms — `(* … *)` and `/* … *\/` — plus
 * `//` to end of line.
 */
function stripLineComments(line: string, state: BlockCommentState): { stripped: string; state: BlockCommentState } {
  const chars = [...line]
  let i = 0
  let s = state

  while (i < chars.length) {
    if (s) {
      const endMarker = s === 'paren' ? ')' : '/'
      if (chars[i] === '*' && chars[i + 1] === endMarker) {
        chars[i] = ' '
        chars[i + 1] = ' '
        i += 2
        s = false
      } else {
        chars[i] = ' '
        i++
      }
    } else {
      if (chars[i] === '/' && chars[i + 1] === '/') {
        for (let j = i; j < chars.length; j++) chars[j] = ' '
        break
      }
      if (chars[i] === '(' && chars[i + 1] === '*') {
        chars[i] = ' '
        chars[i + 1] = ' '
        i += 2
        s = 'paren'
      } else if (chars[i] === '/' && chars[i + 1] === '*') {
        chars[i] = ' '
        chars[i + 1] = ' '
        i += 2
        s = 'slash'
      } else {
        i++
      }
    }
  }

  return { stripped: chars.join(''), state: s }
}

export type UseStDebugDecorationsOptions = {
  editorRef: RefObject<monaco.editor.IStandaloneCodeEditor | null>
  monacoRef: RefObject<typeof monaco | null>
  /** Composite-key prefix, e.g. `MyProgram:` or `Prog:fbInstance.`. */
  prefix: string | undefined
  /** Gate — callers pass false when hidden, not debugging, or non-ST. */
  enabled: boolean
  /**
   * Any value that changes when the model's text changes, so the scan
   * re-runs. The POU editor passes Monaco's version id; simpler
   * surfaces can pass the text itself.
   */
  modelVersion: unknown
  /**
   * Optional guard: when set, decorations are skipped unless the
   * editor's model URI matches. The POU editor needs this because
   * `@monaco-editor/react` can swap models a tick after a tab change.
   */
  expectedUri?: string
}

export function useStDebugDecorations({
  editorRef,
  monacoRef,
  prefix,
  enabled,
  modelVersion,
  expectedUri,
}: UseStDebugDecorationsOptions): void {
  const debugBoolValues = useDebugBoolValuesMap()
  const debugNonBoolValues = useDebugNonBoolValuesMap()

  // Cheap identity for "which variables are live", so the scan doesn't
  // re-run on every poll tick that merely changes values.
  const debugVarKeySet = useMemo(() => {
    const keys: string[] = []
    for (const key of debugBoolValues.keys()) keys.push(key)
    for (const key of debugNonBoolValues.keys()) keys.push(key)
    return keys.sort().join('\0')
  }, [debugBoolValues, debugNonBoolValues])

  const positions = useMemo(() => {
    if (!enabled || prefix === undefined) return null
    const editor = editorRef.current
    if (!editor || !monacoRef.current) return null

    const model = editor.getModel()
    if (!model) return null
    if (expectedUri !== undefined && model.uri.toString() !== expectedUri) return null

    const varNames: string[] = []
    for (const key of debugBoolValues.keys()) {
      if (key.startsWith(prefix)) varNames.push(key.slice(prefix.length))
    }
    for (const key of debugNonBoolValues.keys()) {
      if (key.startsWith(prefix)) varNames.push(key.slice(prefix.length))
    }
    if (varNames.length === 0) return null

    // Longest first so `motor.speed` claims its span before `motor` can.
    varNames.sort((a, b) => b.length - a.length)

    const exprPatterns = varNames.map((expr) => {
      const escaped = expr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return { expr, pattern: new RegExp(`\\b${escaped}(?![\\w.\\[])`, 'gi') }
    })

    const found: Array<{ expr: string; line: number; startCol: number; endCol: number }> = []
    let blockCommentState: BlockCommentState = false

    for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber++) {
      const result = stripLineComments(model.getLineContent(lineNumber), blockCommentState)
      blockCommentState = result.state
      const claimed: Array<[number, number]> = []

      for (const { expr, pattern } of exprPatterns) {
        pattern.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = pattern.exec(result.stripped)) !== null) {
          const startCol = match.index + 1
          const endCol = startCol + match[0].length
          if (claimed.some(([s, e]) => startCol < e && endCol > s)) continue
          claimed.push([startCol, endCol])
          found.push({ expr, line: lineNumber, startCol, endCol })
          break
        }
      }
    }

    return found
    // `debugVarKeySet` stands in for the two maps' key sets; values are
    // read in the effect below, which reruns on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, prefix, expectedUri, debugVarKeySet, modelVersion])

  useEffect(() => {
    const editor = editorRef.current
    const monacoInstance = monacoRef.current
    if (!positions || !editor || !monacoInstance || prefix === undefined) return

    const decorations: monaco.editor.IModelDeltaDecoration[] = positions.map(({ expr, line, startCol, endCol }) => ({
      range: new monacoInstance.Range(line, startCol, line, endCol),
      options: {
        after: {
          content: ` = ${debugBoolValues.get(prefix + expr) ?? debugNonBoolValues.get(prefix + expr) ?? '?'} `,
          inlineClassName: 'debug-inline-value',
        },
      },
    }))

    const collection = editor.createDecorationsCollection(decorations)
    return () => collection.clear()
    // `editorRef` / `monacoRef` are refs: stable identities that never
    // trigger a rerun, and re-reading them here is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, prefix, debugBoolValues, debugNonBoolValues])
}
