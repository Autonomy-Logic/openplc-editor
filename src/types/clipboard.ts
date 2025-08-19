import { edgeSchema, nodeSchema } from '@root/renderer/store/slices/react-flow'
import z from 'zod'

export const clipboardSchema = z.discriminatedUnion('language', [
  z.object({
    language: z.literal('fbd'),
    content: z.object({
      nodes: z.array(nodeSchema),
      edges: z.array(edgeSchema),
    }),
  }),
  z.object({
    language: z.literal('ld'),
    content: z.string(),
  }),
  z.object({
    language: z.literal('st'),
    content: z.object({
      src: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
    }),
  }),
  z.object({
    language: z.literal('il'),
    content: z.string(),
  }),
  z.object({
    language: z.literal('sfc'),
    content: z.string(),
  }),
  z.object({
    language: z.literal('other'),
    content: z.string(),
  }),
])

export type ClipboardType = z.infer<typeof clipboardSchema>
