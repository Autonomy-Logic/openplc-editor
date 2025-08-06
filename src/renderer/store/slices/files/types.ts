import z from 'zod'

const fileSliceTypeSchema = z
  .enum(['function', 'function-block', 'program', 'data-type', 'device', 'resource'])
  .nullable()
type FileSliceType = z.infer<typeof fileSliceTypeSchema>

const fileSliceDataSchema = z.object({
  type: fileSliceTypeSchema,
  filePath: z.string(),
  saved: z.boolean(),
})
const fileSliceDataObjectSchema = z.record(z.string(), fileSliceDataSchema)
type FileSliceData = z.infer<typeof fileSliceDataObjectSchema>

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
  getFile: z
    .function()
    .args(
      z.object({
        name: z.string(),
      }),
    )
    .returns(z.object({ file: fileSliceDataSchema.optional() })),

  getSavedState: z
    .function()
    .args(
      z.object({
        name: z.string(),
      }),
    )
    .returns(z.boolean()),

  checkIfAllFilesAreSaved: z.function().args(z.string()).returns(z.boolean()),

  clearFiles: z.function().args().returns(z.void()),
})

const fileSliceSchema = z.object({
  files: fileSliceDataObjectSchema,
  fileActions: fileSliceActionsSchema,
})
type FileSlice = z.infer<typeof fileSliceSchema>

export type { FileSlice, FileSliceData, FileSliceType }
export { fileSliceActionsSchema, fileSliceDataObjectSchema, fileSliceDataSchema, fileSliceSchema, fileSliceTypeSchema }
