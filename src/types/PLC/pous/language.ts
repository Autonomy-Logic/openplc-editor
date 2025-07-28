import z from 'zod'

const pousLanguageSchema = z.object({
  textual: z.enum(['il', 'st']),
  graphical: z.enum(['ld', 'sfc', 'fbd']),
})
type PousLanguage = z.infer<typeof pousLanguageSchema>

export { PousLanguage, pousLanguageSchema }
