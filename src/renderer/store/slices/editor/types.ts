import z from 'zod'

/** This is a zod schema for the editor slice data.
 * It is used to validate the editor data if needed,
 * in most cases you can use the type inferred from it.
 */
const editorDataSchema = z.object({
  editor: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('available'),
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
        derivation: z.enum(['enum', 'struct', 'array']),
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

/** This is a zod schema for the editor slice actions.
 * It is used to validate the editor actions if needed,
 * in most cases you can use the type inferred from it.
 */
const editorActionsSchema = z.object({
  setEditor: z.function().args(editorDataSchema).returns(z.void()),
  clearEditor: z.function().returns(z.void()),
})

type IEditorData = z.infer<typeof editorDataSchema>
type IEditorActions = z.infer<typeof editorActionsSchema>
type IEditorSlice = IEditorData & {
  editorActions: IEditorActions
}

export { editorDataSchema, type IEditorActions, type IEditorData, type IEditorSlice }
