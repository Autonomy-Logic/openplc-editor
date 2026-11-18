import { DOWNLOAD_STALL_MS, type OpenDownload, readWithStallLimit } from './clang-worker-host'
import { wasmToolchainLoadMessage } from './clang-worker-pool'
import type { WasmToolchainReadiness } from './prepare-toolchain'

/** The message a Python runtime download that failed is reported with. */
export const pythonRuntimeDownloadMessage = (reason: string): string =>
  `The Python runtime could not be downloaded: ${reason}`

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Reads each URL's body to its end and keeps none of it, so a browser's HTTP cache holds the files for later fetches.
 * @param urls The files to download, all at once.
 * @param open The platform's transport.
 * @param stallMs How long one download may receive no bytes before it fails.
 * @throws {Error} `Could not download <url> (HTTP <status>).` or `Download of <url> stalled: no data for <n> s.`
 */
export async function prefetchFiles(
  urls: string[],
  open: OpenDownload,
  stallMs: number = DOWNLOAD_STALL_MS,
): Promise<void> {
  await Promise.all(urls.map((url) => readWithStallLimit(url, open, () => undefined, stallMs)))
}

/**
 * Runs the toolchain and the Python downloads at once; never rejects, and reports each failure once.
 * @param steps The two downloads; the toolchain one reports its own failure as a readiness, or throws.
 * @param report Receives one message per failed download.
 */
export async function startRuntimeDownload(
  steps: { toolchain: () => Promise<WasmToolchainReadiness>; python: () => Promise<void> },
  report: (message: string) => void,
): Promise<void> {
  const toolchain = async (): Promise<void> => {
    try {
      const readiness = await steps.toolchain()
      if (!readiness.ok) report(readiness.message)
    } catch (error) {
      report(wasmToolchainLoadMessage(reasonOf(error)))
    }
  }
  const python = async (): Promise<void> => {
    try {
      await steps.python()
    } catch (error) {
      report(pythonRuntimeDownloadMessage(reasonOf(error)))
    }
  }
  await Promise.all([toolchain(), python()])
}
