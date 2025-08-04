import z from 'zod'

const fileSliceTypeSchema = z.enum(['pou', 'datatype', 'device'])

const fileSliceDataSchema = z.record(
  z.string(),
  z.object({
    type: fileSliceTypeSchema,
    filePath: z.string(),
    saved: z.boolean(),
  }),
)
type FileSliceData = z.infer<typeof fileSliceDataSchema>

const fileSliceActionsSchema = z.object({
  addFile: z
    .function()
    .args(
      z.object({
        name: z.string(),
        type: fileSliceTypeSchema,
        filePath: z.string(),
      }),
    )
    .returns(z.boolean()),

  removeFile: z
    .function()
    .args(
      z.object({
        name: z.string(),
      }),
    )
    .returns(z.void()),

  updateFile: z
    .function()
    .args(
      z.object({
        name: z.string(),
        saved: z.boolean(),
      }),
    )
    .returns(z.void()),

  getSavedState: z
    .function()
    .args(
      z.object({
        name: z.string(),
      }),
    )
    .returns(z.boolean()),

  checkIfAllFilesAreSaved: z.function().args(z.string()).returns(z.boolean()),

  resetFiles: z.function().args(z.object({})).returns(z.void()),
})

const fileSliceSchema = z.object({
  data: fileSliceDataSchema,
  actions: fileSliceActionsSchema,
})
type FileSlice = z.infer<typeof fileSliceSchema>

export type { FileSlice, FileSliceData }
export { fileSliceActionsSchema, fileSliceDataSchema, fileSliceSchema, fileSliceTypeSchema }
