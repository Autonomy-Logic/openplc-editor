import { describe, expect, it } from '@jest/globals'

import { editorLockPolicy, type EditorLockPolicy } from '../slices/editor/lock-policy'
import type { EditorModel } from '../slices/editor/types'

/**
 * A missing key fails the type check, so a new editor type cannot ship
 * unclassified.
 */
const EXPECTED: Record<EditorModel['type'], EditorLockPolicy> = {
  available: 'read-only',
  'plc-diagnostics': 'read-only',
  'diff-viewer': 'read-only',
  'plc-persistent-storage': 'host-locked',
  'plc-user-management': 'host-locked',
  'plc-textual': 'self-locked',
  'plc-graphical': 'self-locked',
  'plc-datatype': 'self-locked',
  'plc-global-variable-list': 'self-locked',
  'plc-resource': 'self-locked',
  'plc-device': 'self-locked',
  'plc-server': 'self-locked',
  'plc-remote-device': 'self-locked',
  'plc-vendor-screen': 'self-locked',
  'plc-package-manager': 'self-locked',
  'plc-library-manager': 'self-locked',
  'plc-library-manifest': 'self-locked',
  'plc-ethercat-device': 'self-locked',
  'plc-ethercat-module': 'self-locked',
}

const isEditorType = (value: string): value is EditorModel['type'] => value in EXPECTED

const CASES = Object.keys(EXPECTED)
  .filter(isEditorType)
  .map((type) => ({ type, policy: EXPECTED[type] }))

describe('editorLockPolicy', () => {
  it.each(CASES)('should classify $type as $policy', ({ type, policy }) => {
    expect(editorLockPolicy(type)).toBe(policy)
  })

  it('should classify every editor type', () => {
    expect(Object.keys(EXPECTED)).toHaveLength(19)
  })

  it('should never answer outside the three policies', () => {
    expect([...new Set(Object.values(EXPECTED))].sort()).toEqual(['host-locked', 'read-only', 'self-locked'])
  })

  it('should keep every editor that owns a sub-tab, a view toggle or a debug action self-locked', () => {
    const selfLocked: EditorModel['type'][] = [
      'plc-textual',
      'plc-graphical',
      'plc-resource',
      'plc-server',
      'plc-device',
      'plc-datatype',
      'plc-global-variable-list',
      'plc-remote-device',
      'plc-package-manager',
      'plc-library-manager',
      'plc-library-manifest',
      'plc-ethercat-device',
      'plc-ethercat-module',
      'plc-vendor-screen',
    ]

    for (const type of selfLocked) {
      expect(editorLockPolicy(type)).toBe('self-locked')
    }
  })
})
