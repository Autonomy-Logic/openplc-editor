import { z } from 'zod'

const IPouTemplateSchema = z.object({
  id: z.number().optional(),
  name: z.string().min(3).default('PouDefault'),
  type: z.enum(['program', 'function', 'functionBlock']).default('program'),
  languageCodification: z.enum(['Graphical', 'Textual']).default('Textual'),
  language: z.enum(['IL', 'ST', 'LD', 'SFC', 'FBD']).default('IL'),
  body: z.string().optional(),
  ref: z.string().optional(),
})

type IPouTemplate = z.infer<typeof IPouTemplateSchema>

const IDataTypeTemplateSchema = z.object({
  id: z.number().optional(),
  derivationType: z.enum(['Directly', 'SubRange', 'Enumerated', 'Array', 'Structure']).default('Directly'),
  baseType: z.string().optional(),
  value: z.string().default(''),
  ref: z.string().optional(),
})

type IDataTypeTemplate = z.infer<typeof IDataTypeTemplateSchema>

const IVariableTemplateSchema = z.object({
  id: z.number().optional(),
  name: z.string().min(3).default('VariableDefault'),
  class: z.string().optional(),
  type: z.string().optional(),
  location: z.string().optional(),
  initialValue: z.string().default(''),
  documentation: z.string().optional(),
  debug: z.boolean().default(false),
  ref: z.string().optional(),
})

type IVariableTemplate = z.infer<typeof IVariableTemplateSchema>
type IProjectData = {
  pous: IPouTemplate[]
  dataTypes: IDataTypeTemplate[]
  variables: IVariableTemplate[]
}

export {
  type IDataTypeTemplate,
  IDataTypeTemplateSchema,
  type IPouTemplate,
  IPouTemplateSchema,
  IProjectData,
  type IVariableTemplate,
  IVariableTemplateSchema,
}
