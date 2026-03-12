import { type BlockCommentState, stripLineComments } from './strip-line-comments'

/**
 * Collect variable names that appear in ST/IL source text.
 * Returns a Set of variable names found in the code, excluding occurrences inside comments.
 */
function collectSTVariableNames(sourceText: string, variableNames: string[]): Set<string> {
  if (variableNames.length === 0 || !sourceText) return new Set()

  // Build regex patterns for each variable name (word-boundary match)
  const patterns = variableNames.map((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return { name, pattern: new RegExp(`\\b${escaped}(?![\\w.\\[])`, 'i') }
  })

  const found = new Set<string>()
  const lines = sourceText.split('\n')
  let blockCommentState: BlockCommentState = false

  for (const line of lines) {
    const result = stripLineComments(line, blockCommentState)
    blockCommentState = result.state

    for (const { name, pattern } of patterns) {
      if (!found.has(name) && pattern.test(result.stripped)) {
        found.add(name)
      }
    }

    // Early exit if all variables found
    if (found.size === variableNames.length) break
  }

  return found
}

export { collectSTVariableNames }
