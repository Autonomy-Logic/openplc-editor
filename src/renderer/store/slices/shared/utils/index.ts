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
  switch (type) {
    case 'function':
      return {
        type: 'function',
        data: {
          name: name,
          language,
          body:
            language === 'ld'
              ? { language, value: { name, rungs: [] } }
              : { language, value: 'This is the body of function' },
          returnType: 'BOOL',
          variables: [],
          documentation: 'Doc for function',
        },
      }
    case 'function-block':
      return {
        type: 'function-block',
        data: {
          name: name,
          language,
          body:
            language === 'ld'
              ? { language, value: { name, rungs: [] } }
              : { language, value: 'This is the body of function' },
          variables: [],
          documentation: 'Doc for function block',
        },
      }
    case 'program':
      return {
        type: 'program',
        data: {
          name: name,
          language,
          body:
            language === 'ld'
              ? { language, value: { name, rungs: [] } }
              : { language, value: 'This is the body of function' },
          variables: [],
          documentation: 'Doc for program',
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
        baseType: 'bool',
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
        variable: [
          {
            name: 'structure0',
            type: { baseType: 'dint' },
          },
        ],
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
