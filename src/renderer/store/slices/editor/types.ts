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

const editorStructureSchema = z.object({
  description: z.string(),
  selectedRow: z.string(),
})

const taskSchema = z.discriminatedUnion('display', [
  z.object({
    display: z.literal('table'),
    selectedRow: z.string(),
  }),
  z.object({ display: z.literal('code') }),
])

const instanceSchema = z.discriminatedUnion('display', [
  z.object({
    display: z.literal('table'),
    selectedRow: z.string(),
  }),
  z.object({ display: z.literal('code') }),
])

/**
 * This is a zod schema for the graphical schema.
 * It is used to validate the graphical schema if needed,
 * in most cases you can use the type inferred from it.
 */
const editorGraphicalSchema = z.discriminatedUnion('language', [
  z.object({
    language: z.literal('ld'),
    openedRungs: z.array(z.object({ rungId: z.string(), open: z.boolean() })),
  }),
  z.object({
    language: z.literal('sfc'),
  }),
  z.object({
    language: z.literal('fbd'),
    hoveringElement: z.object({ elementId: z.string().nullable(), hovering: z.boolean() }),
    canEditorZoom: z.boolean(),
    canEditorPan: z.boolean(),
  }),
])

const cursorPositionSchema = z.object({
  lineNumber: z.number(),
  column: z.number(),
  offset: z.number(),
})

const scrollPositionSchema = z.object({
  top: z.number(),
  left: z.number(),
})

const fbdPositionSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number(),
})

/** This is a zod schema for the model.
 * It is used to validate the model if needed,
 * in most cases you can use the type inferred from it.
 */
const editorModelSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('available'),
      meta: z.object({
        name: z.string(),
      }),
    })
    .extend({
      cursorPosition: cursorPositionSchema.optional(),
      scrollPosition: scrollPositionSchema.optional(),
    }),

  z
    .object({
      type: z.literal('plc-textual'),
      meta: z.object({
        name: z.string(),
        path: z.string(),
        language: z.enum(['il', 'st']),
        pouType: z.enum(['program', 'function', 'function-block']),
      }),
      variable: editorVariablesSchema,
    })
    .extend({
      cursorPosition: cursorPositionSchema.optional(),
      scrollPosition: scrollPositionSchema.optional(),
    }),

  z
    .object({
      type: z.literal('plc-graphical'),
      meta: z.object({
        name: z.string(),
        path: z.string(),
        language: z.enum(['ld', 'sfc', 'fbd']),
        pouType: z.enum(['program', 'function', 'function-block']),
      }),
      variable: editorVariablesSchema,
      graphical: editorGraphicalSchema,
    })
    .extend({
      cursorPosition: cursorPositionSchema.optional(),
      scrollPosition: scrollPositionSchema.optional(),
      fbdPosition: fbdPositionSchema.optional(),
    }),

  z
    .object({
      type: z.literal('plc-datatype'),
      meta: z.object({
        name: z.string(),
        derivation: z.enum(['enumerated', 'structure', 'array']),
      }),
      structure: editorStructureSchema,
    })
    .extend({
      cursorPosition: cursorPositionSchema.optional(),
      scrollPosition: scrollPositionSchema.optional(),
    }),

  z
    .object({
      type: z.literal('plc-resource'),
      meta: z.object({
        name: z.string(),
        path: z.string(),
      }),
      variable: editorGlobalVariablesSchema,
      task: taskSchema,
      instance: instanceSchema,
    })
    .extend({
      cursorPosition: cursorPositionSchema.optional(),
      scrollPosition: scrollPositionSchema.optional(),
    }),

  z
    .object({
      type: z.literal('plc-device'),
      meta: z.object({
        name: z.literal('Configuration'),
        derivation: z.literal('configuration'),
      }),
    })
    .extend({
      cursorPosition: cursorPositionSchema.optional(),
      scrollPosition: scrollPositionSchema.optional(),
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
const _editorActionsSchema = z.object({
  addModel: z.function().args(editorModelSchema).returns(z.void()),
  removeModel: z.function().args(z.string()).returns(z.void()),
  updateEditorModel: z.function().args(z.string(), z.string()).returns(z.void()),
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
  updateModelStructure: z.function().args(
    z.object({
      selectedRow: z.number().optional(),
      description: z.string().optional(),
    }),
  ),
  updateModelTasks: z
    .function()
    .args(z.object({ selectedRow: z.number(), display: z.enum(['code', 'table']) }))
    .returns(z.void()),
  updateModelInstances: z
    .function()
    .args(z.object({ selectedRow: z.number(), display: z.enum(['code', 'table']) }))
    .returns(z.void()),
  updateModelLadder: z
    .function()
    .args(z.object({ openRung: z.object({ rungId: z.string(), open: z.boolean() }).optional() }))
    .returns(z.void()),
  getIsRungOpen: z
    .function()
    .args(z.object({ rungId: z.string() }))
    .returns(z.boolean()),
  updateModelFBD: z
    .function()
    .args(
      z.object({
        hoveringElement: z.object({ elementId: z.string().nullable(), hovering: z.boolean() }).optional(),
        canEditorZoom: z.boolean().optional(),
        canEditorPan: z.boolean().optional(),
      }),
    )
    .returns(z.void()),

  setEditor: z.function().args(editorModelSchema).returns(z.void()),
  clearEditor: z.function().returns(z.void()),
  saveEditorViewState: z
    .function()
    .args(
      z.object({
        prevEditorName: z.string(),
        cursorPosition: cursorPositionSchema.optional(),
        scrollPosition: scrollPositionSchema.optional(),
        fbdPosition: fbdPositionSchema.optional(),
      }),
    )
    .returns(z.void()),
  getEditorFromEditors: z.function().args(z.string()).returns(editorModelSchema.or(z.null())),
})

type StructureTableType = z.infer<typeof editorStructureSchema>
/** The variables, the data that we display in the app. */
type VariablesTable = z.infer<typeof editorVariablesSchema>
type GlobalVariablesTableType = z.infer<typeof editorGlobalVariablesSchema>
type TaskType = z.infer<typeof taskSchema>
type InstanceType = z.infer<typeof instanceSchema>
/** Graphical */
type GraphicalType = z.infer<typeof editorGraphicalSchema>
/** The model, the data that we display in the app. */
type EditorModel = z.infer<typeof editorModelSchema>
/** The state, the source of truth that drives our app. - Concept based on Redux */
type EditorState = z.infer<typeof editorStateSchema>
/** The actions, the events that occur in the app based on user input, and trigger updates in the state - Concept based on Redux */
type EditorActions = z.infer<typeof _editorActionsSchema>
type EditorSlice = EditorState & {
  editorActions: EditorActions
}

export { editorModelSchema, editorStateSchema }

export type {
  EditorActions,
  EditorModel,
  EditorSlice,
  EditorState,
  GlobalVariablesTableType,
  GraphicalType,
  InstanceType,
  StructureTableType,
  TaskType,
  VariablesTable,
}
