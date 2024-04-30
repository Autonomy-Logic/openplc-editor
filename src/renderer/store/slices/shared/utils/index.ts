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
          body: '',
          returnType: 'BOOL',
        },
      }
    case 'function-block':
      return {
        type: 'function-block',
        data: {
          name: name,
          language,
          body: '',
        },
      }
    case 'program':
      return {
        type: 'program',
        data: {
          name: name,
          language,
          body: '',
        },
      }
  }
}

type ICreatedEditorObject = {
  path: string
  language: string
  value: string
  isEditorOpen: boolean
}

const CreateEditorObject = ({ type, name, language }: IPouProps): ICreatedEditorObject => {
  const normalizedPath = `/data/pous/${type}/${name}`
  return {
    path: normalizedPath,
    language,
    value: '',
    isEditorOpen: true,
  }
}

type ICreatedTabObject = {
  name: string
  language: string
  currentTab: boolean
}

const CreateTabObject = ({ name, language }: IPouProps): ICreatedTabObject => {
  return {
    name,
    language,
    currentTab: true,
  }
}

export { CreateEditorObject, CreatePouObject, CreateTabObject }
