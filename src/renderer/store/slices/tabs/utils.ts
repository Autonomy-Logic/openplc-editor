import type { EditorModel } from '../editor'
import { CreateEditorObject } from '../shared/utils'
import { TabsProps } from './types'

const CreatePLCTextualObject = (
  name: string,
  language: 'il' | 'st',
  pouType: 'program' | 'function' | 'function-block',
): EditorModel => {
  const editor = CreateEditorObject({
    type: 'plc-textual',
    meta: {
      name,
      language: language,
      path: `/data/pous/${pouType}/${name}`,
      pouType,
    },
    variable: {
      display: 'table',
      description: '',
      classFilter: 'All',
      selectedRow: '-1',
    },
  })
  return editor
}

const CreatePLCGraphicalObject = (
  name: string,
  language: 'ld' | 'sfc' | 'fbd',
  pouType: 'program' | 'function' | 'function-block',
): EditorModel => {
  const editor = CreateEditorObject({
    type: 'plc-graphical',
    meta: {
      name,
      language: language,
      path: `/data/pous/${pouType}/${name}`,
      pouType,
    },
    variable: {
      display: 'table',
      description: '',
      classFilter: 'All',
      selectedRow: '-1',
    },
    graphical: language === 'ld' ? { language, openedRungs: [] } : { language },
  })
  return editor
}

const CreateEditorModelObject = (
  name: string,
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | null,
  pouType: 'program' | 'function' | 'function-block' | null,
  derivation?: 'enumerated' | 'structure' | 'array',
): EditorModel => {
  if (derivation) {
    const editor = CreateEditorObject({
      type: 'plc-datatype',
      meta: {
        name,
        derivation,
      },
      structure: {
        selectedRow: '-1',
        description: '',
      },
    })
    return editor
  }

  if (!language || !pouType) {
    throw new Error('Language and pouType must be defined')
  }

  if (['ld', 'sfc', 'fbd'].includes(language)) {
    return CreatePLCGraphicalObject(name, language as 'ld' | 'sfc' | 'fbd', pouType)
  }

  return CreatePLCTextualObject(name, language as 'il' | 'st', pouType)
}

const CreateResourceEditor = (name = 'resource'): EditorModel => {
  const editor = CreateEditorObject({
    type: 'plc-resource',
    meta: {
      name,
      path: `/data/configuration/resource`,
    },
    variable: {
      display: 'table',
      description: '',
      selectedRow: '-1',
    },
    task: {
      display: 'table',
      selectedRow: '-1',
    },
    instance: {
      display: 'table',
      selectedRow: '-1',
    },
  })
  return editor
}

const CreateDeviceEditor = (name = 'device', derivation: 'configuration' | 'pin-mapping'): EditorModel => {
  const errorHandler = name as 'Pin Mapping' | 'Configuration'
  if (derivation) {
    const editor = CreateEditorObject({
      type: 'plc-device',
      meta: {
        name: errorHandler,
        derivation,
      },
    })
    return editor
  }

  throw new Error('Invalid derivation value')
}

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
  }
}

export { CreateEditorObjectFromTab }
