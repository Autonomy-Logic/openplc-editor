import { describe, expect, it } from '@jest/globals'

import {
  DIFF_PRODUCING_TOOL_NAMES,
  isMutatingTool,
  isNonDiffMutatingTool,
  MUTATING_TOOL_NAMES,
} from '../tool-definitions'

describe('isMutatingTool', () => {
  it('returns true for every mutating tool', () => {
    for (const name of MUTATING_TOOL_NAMES) {
      expect(isMutatingTool(name)).toBe(true)
    }
  })

  it('returns false for read-only / unknown tools', () => {
    expect(isMutatingTool('read_project_state')).toBe(false)
    expect(isMutatingTool('not_a_tool')).toBe(false)
  })
})

describe('isNonDiffMutatingTool', () => {
  it('returns false for diff-producing mutating tools', () => {
    for (const name of DIFF_PRODUCING_TOOL_NAMES) {
      expect(isNonDiffMutatingTool(name)).toBe(false)
    }
    // Sanity-check the membership the chat panel relies on.
    expect(DIFF_PRODUCING_TOOL_NAMES.has('create_pou')).toBe(true)
    expect(DIFF_PRODUCING_TOOL_NAMES.has('update_pou_body')).toBe(true)
  })

  it('returns true for mutating tools that do not surface per-hunk diffs', () => {
    const nonDiff = [...MUTATING_TOOL_NAMES].filter((name) => !DIFF_PRODUCING_TOOL_NAMES.has(name))
    expect(nonDiff.length).toBeGreaterThan(0)
    for (const name of nonDiff) {
      expect(isNonDiffMutatingTool(name)).toBe(true)
    }
  })

  it('returns false for non-mutating / unknown tools', () => {
    expect(isNonDiffMutatingTool('read_project_state')).toBe(false)
    expect(isNonDiffMutatingTool('not_a_tool')).toBe(false)
  })
})
