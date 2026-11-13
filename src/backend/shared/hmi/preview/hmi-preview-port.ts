/**
 * The HMI preview port every platform uses: reads the preview's resources once through the platform's mechanisms,
 * builds with its toolchain and runs modules in its Workers.
 */
import type {
  HmiPreviewMechanisms,
  HmiPreviewStoredFiles,
} from '../../../../middleware/shared/ports/hmi-preview-mechanisms'
import type { HmiPreviewPort } from '../../../../middleware/shared/ports/hmi-preview-port'
import { buildHmiPreview, type HmiPreviewResources } from './build-hmi-preview'
import { createHmiPreviewSession, type HmiPreviewSessionOptions } from './preview-session'

const SOURCE = /\.(c|h|cpp|hpp)$/
const FONTS = 'fonts/'

const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/**
 * The compiled-in sources as text and the font files as bytes, out of the HMI sources folder's files, and the runtime
 * headers by file name.
 */
export function hmiPreviewResources(
  stored: HmiPreviewStoredFiles,
  storedHeaders: Readonly<Record<string, string>>,
): HmiPreviewResources {
  const hmiFiles: Record<string, string | Uint8Array> = {}
  for (const [path, content] of Object.entries(stored.files)) {
    if (path.startsWith(stored.root)) hmiFiles[path.slice(stored.root.length)] = content
  }
  const runtimeHeaders: Record<string, string> = {}
  for (const [path, content] of Object.entries(storedHeaders)) runtimeHeaders[fileName(path)] = content
  const hmiSources: Record<string, string> = {}
  const decoder = new TextDecoder()
  for (const [path, content] of Object.entries(hmiFiles)) {
    if (path.startsWith(FONTS) || !SOURCE.test(path)) continue
    hmiSources[path] = typeof content === 'string' ? content : decoder.decode(content)
  }
  return {
    runtimeHeaders,
    hmiSources,
    readFont: (file) => {
      const bytes = hmiFiles[`${FONTS}${file}`]
      return bytes instanceof Uint8Array
        ? Promise.resolve(bytes)
        : Promise.reject(new Error(`The HMI font ${file} is not available`))
    },
  }
}

export function createHmiPreviewPort(
  mechanisms: HmiPreviewMechanisms,
  sessionOptions: HmiPreviewSessionOptions = {},
): HmiPreviewPort {
  let resources: Promise<HmiPreviewResources> | null = null
  const loadResources = (): Promise<HmiPreviewResources> => {
    resources ??= Promise.all([mechanisms.readHmiSources(), mechanisms.readStrucppRuntimeHeaders()]).then(
      ([hmiFiles, runtimeHeaders]) => hmiPreviewResources(hmiFiles, runtimeHeaders),
    )
    resources.catch(() => {
      resources = null
    })
    return resources
  }
  return {
    async build(request) {
      let loaded: HmiPreviewResources
      try {
        loaded = await loadResources()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          ok: false,
          errors: [{ file: 'HMI', message: `The preview's files could not be read: ${message}` }],
          warnings: [],
        }
      }
      return buildHmiPreview(request, loaded, (compileRequest) => mechanisms.compileToWasm(compileRequest))
    },
    openSession: () => createHmiPreviewSession(() => mechanisms.startWorker(), sessionOptions),
  }
}
