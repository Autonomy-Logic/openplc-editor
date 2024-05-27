import { PLCDataType, PLCFunction, PLCFunctionBlock, PLCProgram } from '@root/types/PLC/test'
import { z } from 'zod'

type PouProps = {
  type: 'program' | 'function' | 'function-block'
  name: string
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
}

type CreatedPouObject =
  | {
      type: 'program'
      data: PLCProgram
    }
  | {
      type: 'function'
      data: PLCFunction
    }
  | {
      type: 'function-block'
      data: PLCFunctionBlock
    }

const CreatePouObject = ({ type, name, language }: PouProps): CreatedPouObject => {
  switch (type) {
    case 'function':
      return {
        type: 'function',
        data: {
          name: name,
          language,
          body: `This is the body of ${name}`,
          returnType: 'BOOL',
          variables: [
            {
              id: 0,
              name: 'Variable test',
              class: 'input',
              type: { definition: 'base-type', value: 'bool' },
              location: '%123',
              debug: false,
              documentation: 'Doc for var 1',
            },
          ],
          documentation: 'Doc for function',
        },
      }
    case 'function-block':
      return {
        type: 'function-block',
        data: {
          name: name,
          language,
          body: `This is the body of ${name}`,
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
          body: `This is the body of ${name}`,
          variables: [
            {
              id: 0,
              name: 'Variable test',
              class: 'input',
              type: { definition: 'base-type', value: 'bool' },
              location: '%123',
              debug: false,
              documentation: 'Doc for var 1',
            },
          ],
          documentation: 'Doc for program',
        },
      }
  }
}

const CreateDatatypeObject = (derivation: 'enumerated' | 'structure' | 'array'): PLCDataType => {
  switch (derivation) {
    case 'array':
      return {
        id: 0,
        name: 'New array datatype',
        derivation: {
          type: 'array',
          baseType: 'bool',
          dimensions: [],
        },
      }
    case 'enumerated':
      return {
        id: 0,
        name: 'New enum datatype',
        derivation: {
          type: 'enumerated',
          values: [],
          initialValue: '0',
        },
      }
    case 'structure':
      return {
        id: 0,
        name: 'New structure datatype',
        derivation: {
          type: 'structure',
          elements: [],
        },
      }
  }
}

const createEditorObjectSchema = z.object({
  editor: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('available'),
      meta: z.object({
        name: z.string(),
      }),
    }),
    z.object({
      type: z.literal('plc-textual'),
      meta: z.object({
        name: z.string(),
        path: z.string(),
        language: z.enum(['il', 'st']),
      }),
    }),
    z.object({
      type: z.literal('plc-graphical'),
      meta: z.object({
        name: z.string(),
        path: z.string(),
        language: z.enum(['ld', 'sfc', 'fbd']),
      }),
    }),
    z.object({
      type: z.literal('plc-datatype'),
      meta: z.object({
        name: z.string(),
        derivation: z.enum(['enumerated', 'structure', 'array']),
      }),
    }),
    z.object({
      type: z.literal('plc-variable'),
      meta: z.object({
        name: z.string(),
      }),
    }),
  ]),
})

const editorProps = z.object({
  type: z.enum(['available', 'plc-textual', 'plc-graphical', 'plc-datatype', 'plc-variable']),
  name: z.string().optional(),
  language: z.enum(['il', 'st', 'ld', 'sfc', 'fbd']).optional(),
  derivation: z.enum(['program', 'function', 'function-block', 'enumerated', 'structure', 'array']).optional(),
})

type EditorPropsType = z.infer<typeof editorProps>

type CreateEditorObjectType = z.infer<typeof createEditorObjectSchema>

// type ICreatedEditorObject = {
//   name: string
//   path: string
//   language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
//   value: string
// }

const CreateEditorObject = (props: EditorPropsType): CreateEditorObjectType['editor'] => {
  const { type, name, language, derivation } = editorProps.parse(props)
  const normalizedPath = `/data/pous/${derivation}/${name}`

  switch (type) {
    case 'plc-textual':
      return {
        type: 'plc-textual',
        meta: {
          name: name as string,
          path: normalizedPath,
          language: language as 'il' | 'st',
        },
      }
    case 'plc-graphical':
      return {
        type: 'plc-graphical',
        meta: {
          name: name as string,
          path: normalizedPath,
          language: language as 'ld' | 'sfc' | 'fbd',
        },
      }
    case 'plc-datatype':
      return {
        type: 'plc-datatype',
        meta: {
          name: name as string,
          derivation: derivation as 'enumerated' | 'structure' | 'array',
        },
      }
    default:
      return {
        type: 'available',
        meta: {
          name: 'name as string',
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
