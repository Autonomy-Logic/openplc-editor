/**
 * The PLC's library archives for HMI builds, read through the same stlib source the ST language service uses. Each
 * archive's text is kept per source, so later requests read only libraries that are new or changed.
 */
import type { HmiLibraryArchive } from '../../../middleware/shared/ports/hmi-preview-types'
import type { StlibSourcePort } from '../../../middleware/shared/ports/stlib-source-port'

const texts = new WeakMap<StlibSourcePort, Map<string, Promise<string>>>()

/** Every library the source lists; one that cannot be read is left out, and read again next time. */
export async function loadHmiPlcLibraries(source: StlibSourcePort | undefined): Promise<HmiLibraryArchive[]> {
  if (!source) return []
  const listed = await source.listStlibs()
  const known = texts.get(source) ?? new Map<string, Promise<string>>()
  texts.set(source, known)
  const keys = new Set(listed.map((l) => `${l.sourceLabel}\u0000${l.version}`))
  for (const key of known.keys()) if (!keys.has(key)) known.delete(key)
  const loaded = await Promise.all(
    listed.map(async (library): Promise<HmiLibraryArchive | null> => {
      const key = `${library.sourceLabel}\u0000${library.version}`
      let text = known.get(key)
      if (!text) {
        text = source.readStlib(library.sourceLabel)
        known.set(key, text)
      }
      try {
        return { name: library.name, archiveJson: await text }
      } catch {
        known.delete(key)
        return null
      }
    }),
  )
  return loaded.filter((l): l is HmiLibraryArchive => l !== null)
}
