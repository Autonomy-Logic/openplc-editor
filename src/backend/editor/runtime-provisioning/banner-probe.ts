import net from 'node:net'

import type {
  SshBannerProbeMechanism,
  SshBannerReadResult,
} from '@root/middleware/shared/ports/runtime-provisioning-mechanisms'

const SSH_LINE_PREFIX = 'SSH-'

function hasCompleteSshLine(text: string): boolean {
  return text
    .split('\n')
    .slice(0, -1)
    .some((line) => line.startsWith(SSH_LINE_PREFIX))
}

function errorCode(error: Error): string | undefined {
  return 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

function failure(code: string | undefined, timedOut: boolean): SshBannerReadResult {
  return code === undefined ? { kind: 'error', timedOut } : { kind: 'error', code, timedOut }
}

export function createBannerProbeMechanism(): SshBannerProbeMechanism {
  return {
    read({ host, port, timeoutMs, maxBytes }) {
      return new Promise<SshBannerReadResult>((resolve) => {
        const chunks: Uint8Array[] = []
        let received = 0
        let settled = false
        const socket = net.connect({ host, port })

        const collected = (): string => Buffer.concat(chunks).subarray(0, maxBytes).toString('latin1')

        const finish = (result: SshBannerReadResult): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          socket.destroy()
          resolve(result)
        }

        const finishUnlessData = (result: SshBannerReadResult): void => {
          finish(received > 0 ? { kind: 'data', text: collected() } : result)
        }

        const timer = setTimeout(() => finishUnlessData(failure(undefined, true)), timeoutMs)

        socket.on('data', (chunk: Uint8Array) => {
          chunks.push(chunk)
          received += chunk.length
          const text = collected()
          if (received >= maxBytes || hasCompleteSshLine(text)) finish({ kind: 'data', text })
        })
        socket.on('error', (error) => finishUnlessData(failure(errorCode(error), false)))
        socket.on('close', () => finish({ kind: 'data', text: collected() }))
      })
    },
  }
}
