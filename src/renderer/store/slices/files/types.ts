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
type FileSliceData = z.infer<typeof fileSliceDataSchema>

const fileSliceDataObjectSchema = z.record(z.string(), fileSliceDataSchema)
type FileSliceDataObject = z.infer<typeof fileSliceDataObjectSchema>

const fileSliceActionsSchema = z.object({
  setFiles: z
    .function()
    .args(
      z.object({
        files: fileSliceDataObjectSchema,
      }),
    )
    .returns(z.void()),
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
        saved: z.boolean().optional(),
        filePath: z.string().optional(),
        newName: z.string().optional(),
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

  setAllToSaved: z.function().args().returns(z.void()),
  setAllToUnsaved: z.function().args().returns(z.void()),
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

export type { FileSlice, FileSliceData, FileSliceDataObject, FileSliceType }
export { fileSliceActionsSchema, fileSliceDataObjectSchema, fileSliceDataSchema, fileSliceSchema, fileSliceTypeSchema }
