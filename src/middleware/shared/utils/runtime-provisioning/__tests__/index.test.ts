import { decideAfterBootloader } from '../bootloader-state'
import { classifyRuntimeConnectError, startsProvisioningChecks } from '../connect-failure'
import {
  DEFAULT_SSH_PORT,
  PROVISIONING_BOOTLOADER_TIMEOUT_MS,
  SSH_PROBE_MAX_BYTES,
  SSH_PROBE_TIMEOUT_MS,
} from '../constants'
import * as provisioning from '../index'
import { isSshGreeting } from '../ssh-greeting'
import { parseSshPortInput } from '../ssh-port-input'
import { usersInfoFromFacts } from '../users-info-response'

describe('runtime-provisioning index', () => {
  it('re-exports every decision and constant of the module', () => {
    expect(provisioning).toEqual(
      expect.objectContaining({
        classifyRuntimeConnectError,
        startsProvisioningChecks,
        usersInfoFromFacts,
        decideAfterBootloader,
        isSshGreeting,
        parseSshPortInput,
        DEFAULT_SSH_PORT,
        PROVISIONING_BOOTLOADER_TIMEOUT_MS,
        SSH_PROBE_TIMEOUT_MS,
        SSH_PROBE_MAX_BYTES,
      }),
    )
  })
})
