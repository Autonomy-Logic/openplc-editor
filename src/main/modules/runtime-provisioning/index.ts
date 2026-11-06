import { join } from 'node:path'

import { RuntimeApiClient } from '@root/backend/editor/runtime/runtime-api-client'
import { createDesktopProvisioningMechanisms } from '@root/backend/editor/runtime-provisioning/platform-mechanisms'
import { logger } from '@root/backend/editor/services/logger-service'
import type { RuntimeProvisioningService } from '@root/backend/shared/runtime-provisioning/service'
import { createRuntimeProvisioningService } from '@root/backend/shared/runtime-provisioning/service'
import type {
  RuntimeProvisioningEvent,
  RuntimeProvisioningOutcome,
  SshProbeResult,
} from '@root/middleware/shared/ports/runtime-provisioning-port'
import { SshProbeRequestSchema, validateRunRequest } from '@root/middleware/shared/ports/runtime-provisioning-port'

const PROBE_CHANNEL = 'runtime-provisioning:probe-ssh'
const RUN_CHANNEL = 'runtime-provisioning:run'
const CANCEL_CHANNEL = 'runtime-provisioning:cancel'
const EVENT_CHANNEL = 'runtime-provisioning:event'

const HOST_KEY_FILE_NAME = 'ssh-known-hosts.json'

export interface ProvisioningRenderer {
  send(channel: string, ...args: unknown[]): void
  isDestroyed(): boolean
  on(event: 'destroyed', listener: () => void): unknown
  on(event: 'render-process-gone', listener: () => void): unknown
  on(
    event: 'did-start-navigation',
    listener: (details: { isMainFrame: boolean; isSameDocument: boolean }) => void,
  ): unknown
  removeListener(event: 'destroyed', listener: () => void): unknown
  removeListener(event: 'render-process-gone', listener: () => void): unknown
  removeListener(
    event: 'did-start-navigation',
    listener: (details: { isMainFrame: boolean; isSameDocument: boolean }) => void,
  ): unknown
}

export interface ProvisioningIpcMain {
  handle(channel: string, listener: (event: { sender: ProvisioningRenderer }, ...args: unknown[]) => unknown): void
}

export interface ProvisioningApp {
  on(event: 'before-quit', listener: () => void): unknown
}

function watchRenderer(renderer: ProvisioningRenderer, onGone: () => void): () => void {
  const onNavigation = (details: { isMainFrame: boolean; isSameDocument: boolean }): void => {
    if (details.isMainFrame && !details.isSameDocument) onGone()
  }
  renderer.on('destroyed', onGone)
  renderer.on('render-process-gone', onGone)
  renderer.on('did-start-navigation', onNavigation)
  return () => {
    renderer.removeListener('destroyed', onGone)
    renderer.removeListener('render-process-gone', onGone)
    renderer.removeListener('did-start-navigation', onNavigation)
  }
}

export function createDesktopRuntimeProvisioningService(userDataPath: string): RuntimeProvisioningService {
  return createRuntimeProvisioningService(
    createDesktopProvisioningMechanisms({
      hostKeyFilePath: join(userDataPath, HOST_KEY_FILE_NAME),
      runtimeApi: new RuntimeApiClient(),
      audit: logger,
    }),
  )
}

export function registerRuntimeProvisioning({
  ipcMain,
  app,
  service,
}: {
  ipcMain: ProvisioningIpcMain
  app: ProvisioningApp
  service: RuntimeProvisioningService
}): void {
  let runRenderer: ProvisioningRenderer | null = null

  service.onEvent((event: RuntimeProvisioningEvent) => {
    const renderer = runRenderer
    if (renderer !== null && !renderer.isDestroyed()) renderer.send(EVENT_CHANNEL, event)
  })

  ipcMain.handle(PROBE_CHANNEL, (_event, payload): Promise<SshProbeResult> | SshProbeResult => {
    const parsed = SshProbeRequestSchema.safeParse(payload)
    if (!parsed.success) return { answered: false, reason: 'invalid-input' }
    return service.probeSsh(parsed.data)
  })

  ipcMain.handle(RUN_CHANNEL, async (event, payload): Promise<RuntimeProvisioningOutcome> => {
    const validation = validateRunRequest(payload)
    if (!validation.ok) return { kind: 'invalid-input', field: validation.field }
    if (service.inspectState().active) return service.run(validation.request)
    const renderer = event.sender
    runRenderer = renderer
    const stopWatching = watchRenderer(renderer, () => {
      if (runRenderer === renderer && service.inspectState().active) service.detach('renderer-gone')
    })
    try {
      return await service.run(validation.request)
    } finally {
      stopWatching()
      if (runRenderer === renderer) runRenderer = null
    }
  })

  ipcMain.handle(CANCEL_CHANNEL, () => service.cancel())

  app.on('before-quit', () => service.detach('quit'))
}
