// Runs after every other gate, so a secret is only staged for a bundle about to be sent.

import {
  generateMqttRuntimeConfig,
  type GenerateMqttRuntimeConfigInput,
  MqttConfigGenerationError,
  type MqttRuntimeConfigPlan,
  type MqttRuntimeConfigResult,
} from '../../../../frontend/utils/mqtt/runtime/generate'
import type {
  CompilerPlatformPort,
  PlatformDeviceContext,
  PlatformLog,
} from '../../../../middleware/shared/ports/compiler-platform-port'

export interface BindMqttCredentialArgs {
  plan: MqttRuntimeConfigPlan
  generatorInput: Omit<GenerateMqttRuntimeConfigInput, 'credentialRef'>
  context: PlatformDeviceContext
  port: Pick<CompilerPlatformPort, 'stageMqttCredential' | 'discardMqttCredentialStaging'>
  log: PlatformLog
}

export type BindMqttCredentialResult =
  | { ok: true; generated: MqttRuntimeConfigResult; release: () => Promise<void> }
  | { ok: false }

const reportIssue = (log: PlatformLog, server: string, code: string, message: string): void =>
  log(`MQTT Configuration Error:\nMQTT "${server}": ${message} [${code}]`, 'error')

export async function bindMqttCredential(args: BindMqttCredentialArgs): Promise<BindMqttCredentialResult> {
  const { plan, port, context, log } = args
  if (!port.stageMqttCredential) {
    reportIssue(
      log,
      plan.server,
      'config_credential_missing',
      'This platform cannot send the broker credential to the runtime yet.',
    )
    return { ok: false }
  }

  let staged: Awaited<ReturnType<NonNullable<CompilerPlatformPort['stageMqttCredential']>>>
  try {
    staged = await port.stageMqttCredential(
      { context, serverName: plan.server, integration: plan.integration, programMd5: plan.programMd5 },
      log,
    )
  } catch {
    reportIssue(log, plan.server, 'internal_error', 'The broker credential could not be prepared on the runtime.')
    return { ok: false }
  }
  if (!staged.ok) {
    reportIssue(log, plan.server, staged.code, staged.message)
    return { ok: false }
  }

  const stagingId = staged.stagingId
  let released = false
  const release = async (): Promise<void> => {
    if (released || stagingId === null || !port.discardMqttCredentialStaging) return
    released = true
    try {
      await port.discardMqttCredentialStaging({ context, stagingId }, log)
    } catch {
      log('The staged MQTT credential could not be cancelled; the runtime discards it when it expires.', 'warning')
    }
  }

  try {
    const generated = generateMqttRuntimeConfig({ ...args.generatorInput, credentialRef: staged.credentialRef })
    if (generated === null || generated.server !== plan.server) {
      reportIssue(log, plan.server, 'internal_error', 'The MQTT integration changed while the build was running.')
      await release()
      return { ok: false }
    }
    return { ok: true, generated, release }
  } catch (error) {
    if (error instanceof MqttConfigGenerationError) {
      log(`MQTT Configuration Error:\n${error.message}`, 'error')
    } else {
      reportIssue(log, plan.server, 'internal_error', 'conf/mqtt.json could not be generated.')
    }
    await release()
    return { ok: false }
  }
}
