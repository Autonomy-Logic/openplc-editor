import { IFunction, IFunctionBlock, IProgram } from '@root/types/PLC'

type IPouProps = {
  type: 'program' | 'function' | 'function-block'
  name: string
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
}

type ICreatedPouObject =
  | {
      type: 'program'
      data: IProgram
    }
  | {
      type: 'function'
      data: IFunction
    }
  | {
      type: 'function-block'
      data: IFunctionBlock
    }

const CreatePouObject = ({ type, name, language }: IPouProps): ICreatedPouObject => {
  switch (type) {
    case 'function':
      return {
        type: 'function',
        data: {
          name: name,
          language,
          body: `This is the body of ${name}`,
          returnType: 'BOOL',
        },
      }
    case 'function-block':
      return {
        type: 'function-block',
        data: {
          name: name,
          language,
          body: `This is the body of ${name}`,
        },
      }
    case 'program':
      return {
        type: 'program',
        data: {
          name: name,
          language,
          body: `This is the body of ${name}`,
        },
      }
  }
}

type ICreatedEditorObject = {
  name: string
  path: string
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
  value: string
}

const CreateEditorObject = ({ type, name, language }: IPouProps): ICreatedEditorObject => {
  const normalizedPath = `/data/pous/${type}/${name}`
  return {
    name,
    path: normalizedPath,
    language,
    value: '',
  }
}

type ICreatedTabObject = {
  type: 'program' | 'function' | 'function-block'
  name: string
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
}

const CreateTabObject = ({ name, language, type }: IPouProps): ICreatedTabObject => {
  return {
    type,
    name,
    language,
  }
}

export { CreateEditorObject, CreatePouObject, CreateTabObject }