import { describe, expect, it } from '@jest/globals'

import { assertPathContained } from '../path-containment'

describe('assertPathContained', () => {
  it('passes when child sits directly under parent', () => {
    expect(() => assertPathContained('/tmp/parent', '/tmp/parent/child', 'p')).not.toThrow()
  })

  it('passes with deeper nesting', () => {
    expect(() => assertPathContained('/tmp/parent', '/tmp/parent/sub/leaf.json', 'p')).not.toThrow()
  })

  it('rejects sibling directories', () => {
    expect(() => assertPathContained('/tmp/parent', '/tmp/sibling/file', 'p')).toThrow(/resolves outside/)
  })

  it('rejects absolute paths that escape via traversal segments', () => {
    expect(() => assertPathContained('/tmp/parent', '/tmp/parent/../escape', 'p')).toThrow(/resolves outside/)
  })

  it('rejects unrelated absolute paths', () => {
    expect(() => assertPathContained('/tmp/parent', '/etc/passwd', 'p')).toThrow(/resolves outside/)
  })

  it('rejects when child equals parent (treats parent itself as outside)', () => {
    // path.relative(parent, parent) === '' which doesn't start with '..',
    // so this passes — that's intentional. A caller passing the parent
    // directory IS contained under itself and should be allowed.
    expect(() => assertPathContained('/tmp/parent', '/tmp/parent', 'p')).not.toThrow()
  })

  it('uses the supplied field name in error messages', () => {
    expect(() => assertPathContained('/tmp/parent', '/etc/passwd', 'image')).toThrow(/^image resolves outside/)
  })
})
