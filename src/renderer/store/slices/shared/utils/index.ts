import { PLCDataType } from '@root/types/PLC/open-plc'

import type { EditorModel } from '../../editor'
import { editorModelSchema } from '../../editor'
import type { PouDTO } from '../../project/types'

type PouProps = {
  type: 'program' | 'function' | 'function-block'
  name: string
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
}

const CreatePouObject = ({ type, name, language }: PouProps): PouDTO => {
  const bodyValue =
    language === 'ld'
      ? { language, value: { name, rungs: [] } }
      : language === 'fbd'
        ? { language, value: { name, rung: { comment: '', edges: [], nodes: [] } } }
        : { language, value: '' }

  switch (type) {
    case 'function':
      return {
        type: 'function',
        data: {
          name: name,
          language,
          body: bodyValue,
          returnType: 'BOOL',
          variables: [
            {
              id: 'OUT',
              name: 'OUT',
              type: { definition: 'base-type', value: 'bool' },
              class: 'output',
              documentation: '',
              location: '',
              debug: false,
            },
          ],
          documentation: '',
        },
      }
    case 'function-block':
      return {
        type: 'function-block',
        data: {
          name: name,
          language,
          body: bodyValue,
          variables: [],
          documentation: '',
        },
      }
    case 'program':
      return {
        type: 'program',
        data: {
          name: name,
          language,
          body: bodyValue,
          variables: [],
          documentation: '',
        },
      }
  }
}

type DatatypeProps = {
  name: string
  derivation: 'array' | 'structure' | 'enumerated'
}

const CreateDatatypeObject = (data: DatatypeProps): PLCDataType => {
  switch (data.derivation) {
    case 'array':
      return {
        name: data.name,
        derivation: 'array',
        baseType: { definition: 'base-type', value: 'bool' },
        initialValue: 'false',
        dimensions: [],
      }
    case 'enumerated':
      return {
        values: [],
        initialValue: '',
        name: data.name,
        derivation: data.derivation,
      }
    case 'structure':
      return {
        name: data.name,
        derivation: data.derivation,
        variable: [],
      }
  }
}

// type CreateEditorObjectType = z.infer<typeof createEditorObjectSchema>

const CreateEditorObject = (props: EditorModel): EditorModel => {
  const model = editorModelSchema.parse(props)
  const { type, meta } = model

  switch (type) {
    case 'plc-textual':
      return {
        type,
        meta,
        variable: model.variable,
      }
    case 'plc-graphical':
      return {
        type,
        meta,
        variable: model.variable,
        graphical: model.graphical,
      }
    case 'plc-datatype':
      return {
        structure: model.structure,
        type,
        meta,
      }
    case 'plc-resource':
      return {
        type,
        meta,
        variable: model.variable,
        task: model.task,
        instance: model.instance,
      }
    case 'plc-device':
      return {
        type,
        meta,
      }
    default:
      return {
        type: 'available',
        meta: {
          name: 'available',
        },
      }
  }
}

type ICreatedTabObject = {
  type: 'program' | 'function' | 'function-block'
  name: string
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
}

const CreateTabObject = ({ name, language, type }: PouProps): ICreatedTabObject => {
  return {
    type,
    name,
    language,
  }
}

export { CreateDatatypeObject, CreateEditorObject, CreatePouObject, CreateTabObject }
