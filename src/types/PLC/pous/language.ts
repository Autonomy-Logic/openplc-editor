import z from 'zod'

const pousLanguageSchema = z.object({
  textual: z.enum(['il', 'st']),
  graphical: z.enum(['ld', 'sfc', 'fbd']),
})
type PousLanguage = z.infer<typeof pousLanguageSchema>

const pousAllLanguages = [
  ...pousLanguageSchema.shape.textual.options,
  ...pousLanguageSchema.shape.graphical.options,
] as const

export { pousAllLanguages, PousLanguage, pousLanguageSchema }
