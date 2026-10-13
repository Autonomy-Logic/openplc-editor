import {
  isMqttIecType,
  MQTT_DEBUG_SIZE,
  MQTT_LIMITS,
  MQTT_RUNTIME_CONFIG_CONTRACT,
  MQTT_RUNTIME_CONFIG_FORMAT_VERSION,
  type MqttCredentialRef,
  type MqttGenericSection,
  type MqttProjectIntegrationV1,
  type MqttRuntimeAuth,
  type MqttRuntimeConfigV1,
  type MqttRuntimeLeaf,
  type MqttRuntimeTls,
} from '../contract/contract'
import { isMqttSecretAuthMethod } from '../project/model'
import { describeMqttSource, type MqttSourceModel } from '../project/source-model'
import {
  type MqttProjectIssue,
  mqttSelectionDestination,
  type MqttServerIssue,
  type MqttServerLike,
  validateMqttCredentialPresence,
  validateMqttIntegration,
  validateMqttServers,
} from '../project/validate'
import { sparkplugBirthUpperBound } from './birth-size'
import { parseMqttProgramMap, resolveMqttSource } from './program-map'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export interface GenerateMqttRuntimeConfigInput {
  servers: readonly MqttServerLike[] | undefined
  /** What the selected target can run; MQTT is refused when `mqttClient` is false. */
  target: { mqttClient: boolean }
  /** `debug-map.json` of the program being uploaded. */
  debugMapContent: string
  /** Resources instances of the same program. */
  instances: ReadonlyArray<{ name: string; program: string }>
  /** Declarations of the same program; catches types the debug map flattens (enumerations). */
  sourceModel?: MqttSourceModel
  /** Runtime credential reference for password/certificate authentication; never derived from the project. */
  credentialRef?: MqttCredentialRef | null
}

export interface MqttRuntimeConfigResult {
  /** Exact `conf/mqtt.json` content. */
  content: string
  config: MqttRuntimeConfigV1
  server: string
  leafCount: number
  /** Sparkplug NBIRTH upper bound; null in generic mode. */
  birthUpperBoundBytes: number | null
}

export class MqttConfigGenerationError extends Error {
  constructor(public readonly issues: readonly MqttServerIssue[]) {
    super(issues.map(formatMqttServerIssue).join('\n'))
    this.name = 'MqttConfigGenerationError'
  }
}

export const formatMqttServerIssue = (issue: MqttServerIssue): string =>
  `MQTT "${issue.server}": ${issue.message} [${issue.code}${issue.detail ? `/${issue.detail}` : ''} at ${issue.pointer}]`

const isValidCredentialRef = (ref: MqttCredentialRef): boolean =>
  UUID_V4.test(ref.id) &&
  Number.isInteger(ref.revision) &&
  ref.revision >= 1 &&
  (ref.staging_id === null || UUID_V4.test(ref.staging_id))

const runtimeTls = (tls: MqttProjectIntegrationV1['connection']['tls']): MqttRuntimeTls => {
  if (!tls.enabled) return { enabled: false }
  return tls.trust.source === 'pem'
    ? { enabled: true, trust: { source: 'pem', ca_pem: tls.trust.caPem } }
    : { enabled: true, trust: { source: 'system' } }
}

const genericSection = (generic: MqttProjectIntegrationV1['generic']): MqttGenericSection =>
  generic.publishMode === 'on_change'
    ? {
        publish_mode: 'on_change',
        sample_interval_ms: generic.sampleIntervalMs,
        qos: generic.qos,
        retain: generic.retain,
      }
    : {
        publish_mode: 'periodic',
        publish_interval_ms: generic.publishIntervalMs,
        qos: generic.qos,
        retain: generic.retain,
      }

const runtimeAuth = (
  integration: MqttProjectIntegrationV1,
  credentialRef: MqttCredentialRef | null | undefined,
  issues: MqttProjectIssue[],
): MqttRuntimeAuth | null => {
  const method = integration.authMethod
  if (!isMqttSecretAuthMethod(method)) return { method: 'anonymous' }
  if (credentialRef === null || credentialRef === undefined) {
    issues.push(...validateMqttCredentialPresence(integration, { present: false }))
    return null
  }
  if (!isValidCredentialRef(credentialRef)) {
    issues.push({
      code: 'config_credential_missing',
      pointer: '/authMethod',
      message: 'The runtime credential reference is malformed; enter the credentials again.',
      detail: 'credential_ref_invalid',
    })
    return null
  }
  return {
    method,
    credential_ref: { id: credentialRef.id, revision: credentialRef.revision, staging_id: credentialRef.staging_id },
  }
}

const resolveLeaves = (
  integration: MqttProjectIntegrationV1,
  input: GenerateMqttRuntimeConfigInput,
  issues: MqttProjectIssue[],
): { md5: string; leaves: MqttRuntimeLeaf[] } | null => {
  const program = parseMqttProgramMap(input.debugMapContent)
  if (program === null) {
    issues.push({
      code: 'project_program_invalid',
      pointer: '',
      message: 'The compiled program has no usable debug map; MQTT selections cannot be resolved.',
    })
    return null
  }
  const leaves: MqttRuntimeLeaf[] = []
  const addresses = new Map<string, number>()
  integration.selections.forEach((selection, index) => {
    const pointer = `/selections/${index}/source/tokens`
    const destination = mqttSelectionDestination(integration, selection)
    const resolution = resolveMqttSource(selection.source.tokens, input.instances, program)
    if (!resolution.ok) {
      issues.push({
        code: 'project_selection_unresolved',
        pointer,
        message:
          resolution.reason === 'not_a_leaf'
            ? 'Selection points to a structure, block or array instead of a single value.'
            : 'Selection does not match a variable of the compiled program. Repair or remove it.',
        detail: resolution.reason,
      })
      return
    }
    const { leaf } = resolution
    const declared = input.sourceModel ? describeMqttSource(input.sourceModel, selection.source.tokens) : null
    if (declared?.status === 'unsupported') {
      issues.push({
        code: 'config_type_unsupported',
        pointer,
        message: `Type "${declared.typeName}" cannot be published.`,
        detail: declared.reason,
      })
      return
    }
    if (!isMqttIecType(leaf.type)) {
      issues.push({
        code: 'config_type_unsupported',
        pointer,
        message: `Type "${leaf.type}" cannot be published.`,
        detail: 'type_unsupported',
      })
      return
    }
    const declaredMismatch =
      declared !== null && (declared.status !== 'leaf' ? declared.status !== 'opaque' : declared.iecType !== leaf.type)
    if (declaredMismatch) {
      issues.push({
        code: 'project_selection_unresolved',
        pointer,
        message: 'The compiled program and the project declarations disagree on this selection. Recompile.',
        detail: 'declaration_mismatch',
      })
      return
    }
    if (leaf.size !== MQTT_DEBUG_SIZE[leaf.type]) {
      issues.push({
        code: 'config_size_mismatch',
        pointer,
        message: `The compiled size of this ${leaf.type} is not supported.`,
      })
      return
    }
    const addressKey = `${leaf.arr}:${leaf.elem}`
    const first = addresses.get(addressKey)
    if (first !== undefined) {
      issues.push({
        code: 'config_leaf_duplicate',
        pointer,
        message: `Selection ${first + 1} already publishes this value.`,
      })
      return
    }
    addresses.set(addressKey, index)
    if (destination === null) return
    leaves.push({
      source: { tokens: selection.source.tokens.map((t) => ({ ...t })), debug_path: leaf.path },
      address: { arr: leaf.arr, elem: leaf.elem },
      iec_type: leaf.type,
      size: leaf.size,
      destination,
    })
  })
  return { md5: program.md5, leaves }
}

const buildConfig = (
  integration: MqttProjectIntegrationV1,
  md5: string,
  auth: MqttRuntimeAuth,
  leaves: MqttRuntimeLeaf[],
): MqttRuntimeConfigV1 => {
  const base: Pick<MqttRuntimeConfigV1, 'contract' | 'format_version' | 'enabled'> = {
    contract: MQTT_RUNTIME_CONFIG_CONTRACT,
    format_version: MQTT_RUNTIME_CONFIG_FORMAT_VERSION,
    enabled: true,
  }
  const rest = {
    program: { md5 },
    connection: {
      host: integration.connection.host,
      port: integration.connection.port,
      client_id: integration.connection.clientId,
      tls: runtimeTls(integration.connection.tls),
    },
    auth,
  }
  if (integration.mode === 'generic') {
    return { ...base, mode: 'generic', ...rest, generic: genericSection(integration.generic), leaves }
  }
  const { sparkplug } = integration
  return {
    ...base,
    mode: 'sparkplug_b',
    ...rest,
    sparkplug: {
      group_id: sparkplug.groupId,
      edge_node_id: sparkplug.edgeNodeId,
      sample_interval_ms: sparkplug.sampleIntervalMs,
    },
    leaves,
  }
}

/** What an enabled integration resolves to before the runtime credential is bound to it. */
export interface MqttRuntimeConfigPlan {
  server: string
  integration: MqttProjectIntegrationV1
  /** `md5` of the compiled program's debug map: the staged credential is bound to it. */
  programMd5: string
  leafCount: number
  /** Sparkplug NBIRTH upper bound; null in generic mode. */
  birthUpperBoundBytes: number | null
  credentialRequired: boolean
}

interface ResolvedIntegration {
  server: string
  integration: MqttProjectIntegrationV1
  md5: string
  leaves: MqttRuntimeLeaf[]
  auth: MqttRuntimeAuth | null
  birthUpperBoundBytes: number | null
  fail: (issue?: MqttProjectIssue) => never
}

const resolveEnabledIntegration = (
  input: GenerateMqttRuntimeConfigInput,
  bindCredential: boolean,
): ResolvedIntegration | null => {
  const servers = input.servers ?? []
  const enabled = servers.filter((s) => s.protocol === 'mqtt' && s.mqttConfig?.enabled === true)
  const server = enabled[0]
  if (server?.mqttConfig === undefined) return null

  const serverIssues = validateMqttServers(servers, input.target)
  if (serverIssues.length > 0) throw new MqttConfigGenerationError(serverIssues)

  const integration = server.mqttConfig
  const issues: MqttProjectIssue[] = validateMqttIntegration(integration)
  const auth = bindCredential ? runtimeAuth(integration, input.credentialRef, issues) : null
  const resolved = issues.length === 0 ? resolveLeaves(integration, input, issues) : null
  const fail = (issue?: MqttProjectIssue): never => {
    if (issue) issues.push(issue)
    throw new MqttConfigGenerationError(issues.map((item) => ({ ...item, server: server.name })))
  }
  if (resolved === null || (bindCredential && auth === null) || issues.length > 0) return fail()

  let birthUpperBoundBytes: number | null = null
  if (integration.mode === 'sparkplug_b') {
    birthUpperBoundBytes = sparkplugBirthUpperBound(
      resolved.leaves.map((leaf) => ({ destination: leaf.destination, iecType: leaf.iec_type, size: leaf.size })),
    )
    if (birthUpperBoundBytes > MQTT_LIMITS.maxPayloadBytes) {
      return fail({
        code: 'config_payload_too_large',
        pointer: '/selections',
        message: `The Sparkplug birth message can reach ${birthUpperBoundBytes} bytes; the limit is ${MQTT_LIMITS.maxPayloadBytes}.`,
      })
    }
  }
  return {
    server: server.name,
    integration,
    md5: resolved.md5,
    leaves: resolved.leaves,
    auth,
    birthUpperBoundBytes,
    fail,
  }
}

/** Generator validation without the credential, so a deploy refuses a broken config before sending a secret. */
export const planMqttRuntimeConfig = (input: GenerateMqttRuntimeConfigInput): MqttRuntimeConfigPlan | null => {
  const resolved = resolveEnabledIntegration(input, false)
  if (resolved === null) return null
  return {
    server: resolved.server,
    integration: resolved.integration,
    programMd5: resolved.md5,
    leafCount: resolved.leaves.length,
    birthUpperBoundBytes: resolved.birthUpperBoundBytes,
    credentialRequired: isMqttSecretAuthMethod(resolved.integration.authMethod),
  }
}

/** Null when no integration is enabled (the file must be absent); never a partial file. */
export const generateMqttRuntimeConfig = (input: GenerateMqttRuntimeConfigInput): MqttRuntimeConfigResult | null => {
  const resolved = resolveEnabledIntegration(input, true)
  if (resolved === null) return null
  const { integration, auth, leaves, fail } = resolved
  if (auth === null) return fail()

  const config = buildConfig(integration, resolved.md5, auth, leaves)
  const content = `${JSON.stringify(config, null, 2)}\n`
  if (new TextEncoder().encode(content).length > MQTT_LIMITS.maxConfigBytes) {
    return fail({
      code: 'config_too_large',
      pointer: '/selections',
      message: `The MQTT configuration exceeds ${MQTT_LIMITS.maxConfigBytes} bytes; select fewer or shorter paths.`,
    })
  }
  return {
    content,
    config,
    server: resolved.server,
    leafCount: leaves.length,
    birthUpperBoundBytes: resolved.birthUpperBoundBytes,
  }
}
