import z from 'zod'

/** This is a zod schema for the variables.
 * It is used to validate the variables if needed,
 * in most cases you can use the type inferred from it.
 */
const editorVariablesSchema = z.discriminatedUnion('display', [
  z.object({
    display: z.literal('table'),
    description: z.string(),
    classFilter: z.enum(['All', 'Local', 'Input', 'Output', 'InOut', 'External', 'Temp']),
    selectedRow: z.string(),
  }),
  z.object({ display: z.literal('code') }),
])

const editorGlobalVariablesSchema = z.discriminatedUnion('display', [
  z.object({
    display: z.literal('table'),
    description: z.string(),
    selectedRow: z.string(),
  }),
  z.object({ display: z.literal('code') }),
])
/** This is a zod schema for the model.
 * It is used to validate the model if needed,
 * in most cases you can use the type inferred from it.
 */
const editorModelSchema = z.discriminatedUnion('type', [
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
      pouType: z.enum(['program', 'function', 'function-block']),
    }),
    variable: editorVariablesSchema,
  }),
  z.object({
    type: z.literal('plc-graphical'),
    meta: z.object({
      name: z.string(),
      path: z.string(),
      language: z.enum(['ld', 'sfc', 'fbd']),
      pouType: z.enum(['program', 'function', 'function-block']),
    }),
    variable: editorVariablesSchema,
  }),
  z.object({
    type: z.literal('plc-datatype'),
    meta: z.object({
      name: z.string(),
      derivation: z.enum(['enumerated', 'structure', 'array']),
    }),
  }),
  z.object({
    type: z.literal('plc-resource'),
    meta: z.object({
      name: z.string(),
      path: z.string(),
    }),
    variable: editorGlobalVariablesSchema,
  }),
])

/** This is a zod schema for the editor slice state.
 * It is used to validate the editor data if needed,
 * in most cases you can use the type inferred from it.
 */
const editorStateSchema = z.object({
  editors: z.array(editorModelSchema),
  editor: editorModelSchema,
})

/** This is a zod schema for the editor slice actions.
 * It is used to validate the editor actions if needed,
 * in most cases you can use the type inferred from it.
 */
const editorActionsSchema = z.object({
  addModel: z.function().args(editorModelSchema).returns(z.void()),
  removeModel: z.function().args(z.string()).returns(z.void()),
  updateModelVariables: z
    .function()
    .args(
      z.object({
        display: z.enum(['code', 'table']),
        selectedRow: z.number().optional(),
        classFilter: z.enum(['All', 'Local', 'Input', 'Output', 'InOut', 'External', 'Temp']).optional(),
        description: z.string().optional(),
      }),
    )
    .returns(z.void()),
  setEditor: z.function().args(editorModelSchema).returns(z.void()),
  clearEditor: z.function().returns(z.void()),
  getEditorFromEditors: z.function().args(z.string()).returns(editorModelSchema.or(z.null())),
})

/** The variables, the data that we display in the app. */
type VariablesTable = z.infer<typeof editorVariablesSchema>
type GlobalVariablesTableType = z.infer<typeof editorGlobalVariablesSchema>
/** The model, the data that we display in the app. */
type EditorModel = z.infer<typeof editorModelSchema>
/** The state, the source of truth that drives our app. - Concept based on Redux */
type EditorState = z.infer<typeof editorStateSchema>
/** The actions, the events that occur in the app based on user input, and trigger updates in the state - Concept based on Redux */
type EditorActions = z.infer<typeof editorActionsSchema>
type EditorSlice = EditorState & {
  editorActions: EditorActions
}

export { editorModelSchema, editorStateSchema }

export type { EditorActions, EditorModel, EditorSlice, EditorState, GlobalVariablesTableType, VariablesTable }
