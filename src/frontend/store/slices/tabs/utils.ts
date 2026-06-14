import type { EditorModel } from '../editor/types'
import type { TabsProps } from './types'

const CreatePLCTextualObject = (
  name: string,
  language: 'il' | 'st' | 'python' | 'cpp',
  pouType: 'program' | 'function' | 'function-block',
): EditorModel => ({
  type: 'plc-textual',
  meta: {
    name,
    language,
    path: `/data/pous/${pouType}/${language}/${name}`,
    pouType,
  },
  variable: {
    display: 'table',
    description: '',
    classFilter: 'All',
    selectedRow: '-1',
  },
})

const CreatePLCGraphicalObject = (
  name: string,
  language: 'ld' | 'sfc' | 'fbd',
  pouType: 'program' | 'function' | 'function-block',
): EditorModel => ({
  type: 'plc-graphical',
  meta: {
    name,
    language,
    path: `/data/pous/${pouType}/${language}/${name}`,
    pouType,
  },
  variable: {
    display: 'table',
    description: '',
    classFilter: 'All',
    selectedRow: '-1',
  },
  graphical:
    language === 'ld'
      ? { language, openedRungs: [] }
      : language === 'fbd'
        ? { language, hoveringElement: { elementId: null, hovering: false }, canEditorZoom: true, canEditorPan: true }
        : { language },
})

const CreateEditorModelObject = (
  name: string,
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp' | null,
  pouType: 'program' | 'function' | 'function-block' | null,
  derivation?: 'enumerated' | 'structure' | 'array',
): EditorModel => {
  if (derivation) {
    return {
      type: 'plc-datatype',
      meta: { name, derivation },
      structure: { selectedRow: '-1', description: '' },
    }
  }

  if (!language || !pouType) {
    throw new Error('Language and pouType must be defined')
  }

  if (['ld', 'sfc', 'fbd'].includes(language)) {
    return CreatePLCGraphicalObject(name, language as 'ld' | 'sfc' | 'fbd', pouType)
  }

  return CreatePLCTextualObject(name, language as 'il' | 'st' | 'python' | 'cpp', pouType)
}

const CreateResourceEditor = (name = 'Resource'): EditorModel => ({
  type: 'plc-resource',
  meta: { name, path: `/data/configuration/resource` },
  variable: { display: 'table', description: '', selectedRow: '-1' },
  task: { display: 'table', selectedRow: '-1' },
  instance: { display: 'table', selectedRow: '-1' },
})

const CreateDeviceEditor = (
  name = 'device',
  derivation: 'configuration' | 'pin-mapping' | 'orchestrators',
): EditorModel => {
  if (!derivation) throw new Error('Invalid derivation value')
  return {
    type: 'plc-device',
    meta: { name, derivation },
  }
}

const CreateRemoteDeviceEditor = (
  name: string,
  protocol: 'modbus-tcp' | 'ethernet-ip' | 'ethercat' | 'profinet',
): EditorModel => ({
  type: 'plc-remote-device',
  meta: { name, protocol },
})

const CreateEtherCATDeviceEditor = (name: string, busName: string, deviceId: string): EditorModel => ({
  type: 'plc-ethercat-device',
  meta: { name, busName, deviceId },
})

const CreateServerEditor = (
  name: string,
  protocol: 'modbus-tcp' | 's7comm' | 'ethernet-ip' | 'opcua',
): EditorModel => ({
  type: 'plc-server',
  meta: { name, protocol },
})

const CreateVendorScreenEditor = (name: string, screenName: string): EditorModel => ({
  type: 'plc-vendor-screen',
  meta: { name, screenName },
})

const CreatePackageManagerEditor = (name = 'Package Manager'): EditorModel => ({
  type: 'plc-package-manager',
  meta: { name },
})

const CreateLibraryManagerEditor = (name = 'Library Manager'): EditorModel => ({
  type: 'plc-library-manager',
  meta: { name },
})

/** Canonical tab name + factory for the Library Project's manifest
 *  editor.  Display label (also the file-slice key the dirty
 *  tracker + save flow look up under); intentionally NOT the on-
 *  disk filename — the file is `library.json` and the save flow
 *  joins it against `project.meta.path` independently. */
const LIBRARY_MANIFEST_TAB_NAME = 'Manifest'

const CreateLibraryManifestEditor = (name = LIBRARY_MANIFEST_TAB_NAME): EditorModel => ({
  type: 'plc-library-manifest',
  meta: { name },
})

/** Read-only source-control diff tab. The tab `name` doubles as the unique
 *  editor key, so it must not collide with the editable POU tab of the same
 *  POU — callers pass a `Diff: <filePath>` style name. `filePath` is the
 *  project-relative path the diff view resolves its before/after content from. */
const CreateDiffViewerEditor = (name: string, filePath: string): EditorModel => ({
  type: 'diff-viewer',
  meta: { name, filePath },
})

const CreateEditorObjectFromTab = (tab: TabsProps): EditorModel => {
  const { elementType, name } = tab
  switch (elementType.type) {
    case 'program':
      return CreateEditorModelObject(name, elementType.language, 'program')
    case 'function':
      return CreateEditorModelObject(name, elementType.language, 'function')
    case 'function-block':
      return CreateEditorModelObject(name, elementType.language, 'function-block')
    case 'data-type':
      return CreateEditorModelObject(name, null, null, elementType.derivation)
    case 'resource':
      return CreateResourceEditor(name)
    case 'device':
      return CreateDeviceEditor(name, elementType.derivation)
    case 'remote-device':
      return CreateRemoteDeviceEditor(name, elementType.protocol)
    case 'ethercat-device':
      return CreateEtherCATDeviceEditor(name, elementType.busName, elementType.deviceId)
    case 'server':
      return CreateServerEditor(name, elementType.protocol)
    case 'vendor-screen':
      return CreateVendorScreenEditor(name, elementType.screenName)
    case 'package-manager':
      return CreatePackageManagerEditor(name)
    case 'library-manager':
      return CreateLibraryManagerEditor(name)
    case 'library-manifest':
      return CreateLibraryManifestEditor(name)
    case 'diff-viewer':
      return CreateDiffViewerEditor(name, elementType.filePath)
  }
}

export {
  CreateDeviceEditor,
  CreateDiffViewerEditor,
  CreateEditorModelObject,
  CreateEditorObjectFromTab,
  CreateEtherCATDeviceEditor,
  CreateLibraryManagerEditor,
  CreateLibraryManifestEditor,
  CreatePackageManagerEditor,
  CreatePLCGraphicalObject,
  CreatePLCTextualObject,
  CreateRemoteDeviceEditor,
  CreateResourceEditor,
  CreateServerEditor,
  CreateVendorScreenEditor,
  LIBRARY_MANIFEST_TAB_NAME,
}
