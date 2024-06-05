import z from 'zod'

/** This is a zod schema for the editor slice state.
 * It is used to validate the editor data if needed,
 * in most cases you can use the type inferred from it.
 */
const editorStateSchema = z.object({
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

/** This is a zod schema for the editor slice actions.
 * It is used to validate the editor actions if needed,
 * in most cases you can use the type inferred from it.
 */
const editorActionsSchema = z.object({
  setEditor: z
    .function()
    .args(editorStateSchema.pick({ editor: true }))
    .returns(z.void()),
  clearEditor: z.function().returns(z.void()),
})

/** The state, the source of truth that drives our app. - Concept based on Redux */
type EditorState = z.infer<typeof editorStateSchema>
/** The actions, the events that occur in the app based on user input, and trigger updates in the state - Concept based on Redux */
type EditorActions = z.infer<typeof editorActionsSchema>
type EditorSlice = EditorState & {
  editorActions: EditorActions
}

export { editorStateSchema }

export type { EditorActions, EditorSlice, EditorState }
