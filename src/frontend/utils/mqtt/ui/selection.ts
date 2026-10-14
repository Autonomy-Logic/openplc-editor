import { MQTT_LIMITS, type MqttProjectIntegrationV1, type MqttSourceToken } from '../contract/contract'
import {
  collectMqttLeaves,
  countMqttLeaves,
  mqttSourceKey,
  type MqttSourceModel,
  type MqttTreeNode,
} from '../project/source-model'

export type MqttSelectionChange =
  | { ok: true; integration: MqttProjectIntegrationV1; changed: number }
  | { ok: false; message: string }

const sameToken = (a: MqttSourceToken, b: MqttSourceToken): boolean => {
  if (a.role === 'index' || b.role === 'index') {
    return (
      a.role === 'index' &&
      b.role === 'index' &&
      a.indices.length === b.indices.length &&
      a.indices.every((value, i) => value === b.indices[i])
    )
  }
  return a.role === b.role && a.name === b.name
}

/** True when `tokens` lies under (or is) the path `prefix`. */
export const isMqttTokenPrefix = (prefix: readonly MqttSourceToken[], tokens: readonly MqttSourceToken[]): boolean =>
  prefix.length <= tokens.length && prefix.every((token, i) => sameToken(token, tokens[i]))

export const mqttSelectedKeys = (integration: MqttProjectIntegrationV1): Set<string> =>
  new Set(integration.selections.map((s) => mqttSourceKey(s.source.tokens)))

/** Selected leaves under a node path, invalid ones included. */
export const countMqttSelectedUnder = (
  integration: MqttProjectIntegrationV1,
  prefix: readonly MqttSourceToken[],
): number => integration.selections.filter((s) => isMqttTokenPrefix(prefix, s.source.tokens)).length

const limitMessage = (adding: number, current: number): string =>
  `Selecting ${adding} more leaves would exceed the limit of ${MQTT_LIMITS.maxLeaves} (${current} already selected).`

const copyTokens = (tokens: readonly MqttSourceToken[]): MqttSourceToken[] =>
  tokens.map((t) => (t.role === 'index' ? { role: 'index', indices: [...t.indices] } : { role: t.role, name: t.name }))

/** Adds a leaf, or removes it when it is already selected. */
export const toggleMqttLeafSelection = (
  integration: MqttProjectIntegrationV1,
  tokens: readonly MqttSourceToken[],
): MqttSelectionChange => {
  const key = mqttSourceKey(tokens)
  const index = integration.selections.findIndex((s) => mqttSourceKey(s.source.tokens) === key)
  if (index >= 0) {
    return {
      ok: true,
      integration: { ...integration, selections: integration.selections.filter((_, i) => i !== index) },
      changed: 1,
    }
  }
  if (integration.selections.length >= MQTT_LIMITS.maxLeaves) {
    return { ok: false, message: limitMessage(1, integration.selections.length) }
  }
  return {
    ok: true,
    integration: {
      ...integration,
      selections: [...integration.selections, { source: { tokens: copyTokens(tokens) } }],
    },
    changed: 1,
  }
}

/** Selects every publishable leaf under a node, refusing the whole operation when it would pass the limit. */
export const selectMqttSubtree = (
  model: MqttSourceModel,
  integration: MqttProjectIntegrationV1,
  node: MqttTreeNode,
): MqttSelectionChange => {
  const selected = mqttSelectedKeys(integration)
  const total = countMqttLeaves(model, node)
  const alreadyUnder = countMqttSelectedUnder(integration, node.tokens)
  const room = MQTT_LIMITS.maxLeaves - integration.selections.length
  // Cheap bound first, so a huge array is refused without materialising its elements.
  if (total - alreadyUnder > room) {
    return { ok: false, message: limitMessage(total - alreadyUnder, integration.selections.length) }
  }
  const { leaves } = collectMqttLeaves(model, node, MQTT_LIMITS.maxLeaves)
  const added = leaves.filter((leaf) => !selected.has(mqttSourceKey(leaf.tokens)))
  if (added.length > room) {
    return { ok: false, message: limitMessage(added.length, integration.selections.length) }
  }
  return {
    ok: true,
    integration: {
      ...integration,
      selections: [
        ...integration.selections,
        ...added.map((leaf) => ({ source: { tokens: copyTokens(leaf.tokens) } })),
      ],
    },
    changed: added.length,
  }
}

/** Removes every selection under a node path. */
export const clearMqttSubtree = (
  integration: MqttProjectIntegrationV1,
  prefix: readonly MqttSourceToken[],
): MqttSelectionChange => {
  const kept = integration.selections.filter((s) => !isMqttTokenPrefix(prefix, s.source.tokens))
  return {
    ok: true,
    integration: { ...integration, selections: kept },
    changed: integration.selections.length - kept.length,
  }
}

export const removeMqttSelection = (
  integration: MqttProjectIntegrationV1,
  index: number,
): MqttProjectIntegrationV1 => ({
  ...integration,
  selections: integration.selections.filter((_, i) => i !== index),
})

/** Sets the destination of the active mode; an empty value returns the selection to its default destination. */
export const setMqttSelectionDestination = (
  integration: MqttProjectIntegrationV1,
  index: number,
  value: string,
): MqttProjectIntegrationV1 => {
  const generic = integration.mode === 'generic'
  return {
    ...integration,
    selections: integration.selections.map((selection, i) => {
      if (i !== index) return selection
      const topic = generic ? (value === '' ? undefined : value) : selection.topic
      const metricName = generic ? selection.metricName : value === '' ? undefined : value
      return {
        source: selection.source,
        ...(topic !== undefined ? { topic } : {}),
        ...(metricName !== undefined ? { metricName } : {}),
      }
    }),
  }
}
