import type { UsersInfoRawFacts } from '@root/middleware/shared/ports/runtime-port'
import type {
  ClockMechanism,
  RuntimeProvisioningMechanisms,
} from '@root/middleware/shared/ports/runtime-provisioning-mechanisms'

import { createBannerProbeMechanism } from './banner-probe'
import { createHostKeyFileMechanism } from './host-key-file'
import { createSshSessionMechanism } from './ssh-session'

export interface ProvisioningRuntimeApi {
  getUsersInfoFacts(address: string): Promise<UsersInfoRawFacts>
}

export interface ProvisioningAuditLog {
  info(message: string): unknown
}

function abortError(): Error {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortError())
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(abortError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

const desktopClock: ClockMechanism = {
  now: () => Date.now(),
  sleep,
}

export function createDesktopProvisioningMechanisms({
  hostKeyFilePath,
  runtimeApi,
  audit,
}: {
  hostKeyFilePath: string
  runtimeApi: ProvisioningRuntimeApi
  audit: ProvisioningAuditLog
}): RuntimeProvisioningMechanisms {
  return {
    bannerProbe: createBannerProbeMechanism(),
    sshSession: createSshSessionMechanism(),
    hostKeyFile: createHostKeyFileMechanism(hostKeyFilePath),
    reachability: {
      check: (host) => runtimeApi.getUsersInfoFacts(host),
    },
    clock: desktopClock,
    audit: {
      write: (line) => {
        audit.info(line)
      },
    },
  }
}
