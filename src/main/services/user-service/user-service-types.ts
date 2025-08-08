import { z } from 'zod'

const HelpSchema = z.object({
  online: z.string(),
})

const BoardSchema = z.object({
  name: z.string(),
  fqbn: z.string().optional(),
})

const ReleaseSchema = z.object({
  name: z.string(),
  version: z.string(),
  types: z.array(z.string()),
  installed: z.boolean().optional(),
  boards: z.array(BoardSchema),
  help: HelpSchema,
  compatible: z.boolean(),
})

const PlatformSchema = z.object({
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

const ArduinoCoreListOutputSchema = z.object({
  platforms: z.array(PlatformSchema),
})

/**
 * Describes the properties of an available update for a library.
 */
const LibraryReleaseSchema = z.object({
  author: z.string(),
  version: z.string(),
  maintainer: z.string(),
  sentence: z.string(),
  paragraph: z.string(),
  website: z.string(),
  category: z.string(),
  architectures: z.array(z.string()),
  types: z.array(z.string()),
})

/**
 * Describes the detailed properties of an installed Arduino library.
 */
const LibrarySchema = z.object({
  name: z.string(),
  author: z.string(),
  maintainer: z.string(),
  sentence: z.string(),
  paragraph: z.string(),
  website: z.string(),
  category: z.string(),
  architectures: z.array(z.string()),
  install_dir: z.string(),
  source_dir: z.string(),
  version: z.string(),
  license: z.string(),
  properties: z.record(z.unknown()),
  location: z.string(),
  layout: z.string(),
  examples: z.array(z.string()),
  provides_includes: z.array(z.string()),
  compatible_with: z.record(z.unknown()), // An object with unknown keys/values
})

/**
 * Represents a single installed library, which may have an associated available update.
 */
const InstalledLibrarySchema = z.object({
  library: LibrarySchema,
  release: LibraryReleaseSchema.optional(),
})

/**
 * Defines the root structure containing a list of all installed Arduino libraries.
 */
const ArduinoLibraryListOutputSchema = z.object({
  installed_libraries: z.array(InstalledLibrarySchema),
})

export const ArduinoListOutputSchemas = z.object({
  core: ArduinoCoreListOutputSchema,
  library: ArduinoLibraryListOutputSchema,
})

type ArduinoListOutput = z.infer<typeof ArduinoListOutputSchemas>

export type { ArduinoListOutput, Platform }
