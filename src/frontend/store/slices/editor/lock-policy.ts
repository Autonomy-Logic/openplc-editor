import type { EditorModel } from './types'

export type EditorLockPolicy = 'host-locked' | 'self-locked' | 'read-only'

/**
 * `host-locked` editors are wrapped whole by the host. `self-locked` ones own
 * controls a debug session keeps available, so they read the lock per control.
 * `read-only` ones change nothing in the project.
 */
export function editorLockPolicy(type: EditorModel['type']): EditorLockPolicy {
  switch (type) {
    case 'available':
    case 'plc-diagnostics':
    case 'diff-viewer':
      return 'read-only'
    case 'plc-persistent-storage':
    case 'plc-user-management':
    case 'plc-hmi-settings':
      return 'host-locked'
    case 'plc-textual':
    case 'plc-graphical':
    case 'plc-datatype':
    case 'plc-global-variable-list':
    case 'plc-resource':
    case 'plc-device':
    case 'plc-server':
    case 'plc-remote-device':
    case 'plc-vendor-screen':
    case 'plc-package-manager':
    case 'plc-library-manager':
    case 'plc-library-manifest':
    case 'plc-ethercat-device':
    case 'plc-ethercat-module':
    case 'plc-hmi':
      return 'self-locked'
    default: {
      const unreachable: never = type
      return unreachable
    }
  }
}
