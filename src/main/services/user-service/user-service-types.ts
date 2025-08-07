import { z } from 'zod'

export const HelpSchema = z.object({
  online: z.string(),
})

export const BoardSchema = z.object({
  name: z.string(),
  fqbn: z.string().optional(),
})

export const ReleaseSchema = z.object({
  name: z.string(),
  version: z.string(),
  types: z.array(z.string()),
  installed: z.boolean().optional(),
  boards: z.array(BoardSchema),
  help: HelpSchema,
  compatible: z.boolean(),
})

export const PlatformSchema = z.object({
  id: z.string(),
  maintainer: z.string(),
  website: z.string(),
  email: z.string(),
  indexed: z.boolean(),
  releases: z.record(ReleaseSchema),
  installed_version: z.string(),
  latest_version: z.string(),
})

type Platform = z.infer<typeof PlatformSchema>

export const ArduinoPlatformDataSchema = z.object({
  platforms: z.array(PlatformSchema),
})

type ArduinoPlatformData = z.infer<typeof ArduinoPlatformDataSchema>

export type { ArduinoPlatformData, Platform }
