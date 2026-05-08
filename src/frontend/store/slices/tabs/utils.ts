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
  }
}

export {
  CreateDeviceEditor,
  CreateEditorModelObject,
  CreateEditorObjectFromTab,
  CreateEtherCATDeviceEditor,
  CreatePLCGraphicalObject,
  CreatePLCTextualObject,
  CreateRemoteDeviceEditor,
  CreateResourceEditor,
  CreateServerEditor,
}
