import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  HostKeyFileMechanism,
  HostKeyFileReadResult,
} from '@root/middleware/shared/ports/runtime-provisioning-mechanisms'

const OWNER_ONLY = 0o600

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

function errorMessage(error: unknown): string {
  return typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
    ? error.message
    : String(error)
}

export function createHostKeyFileMechanism(filePath: string): HostKeyFileMechanism {
  return {
    async read(): Promise<HostKeyFileReadResult> {
      try {
        return { kind: 'text', text: await readFile(filePath, 'utf8') }
      } catch (error) {
        if (errorCode(error) === 'ENOENT') return { kind: 'absent' }
        return { kind: 'error', message: errorMessage(error) }
      }
    },

    async replace(text) {
      const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`)
      try {
        await writeFile(temporary, text, { encoding: 'utf8', mode: OWNER_ONLY, flag: 'wx' })
        await rename(temporary, filePath)
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined)
        throw error
      }
    },
  }
}
