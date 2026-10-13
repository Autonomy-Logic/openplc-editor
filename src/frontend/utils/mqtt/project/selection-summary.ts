import { MQTT_LIMITS, type MqttProjectIntegrationV1 } from '../contract/contract'
import { type SparkplugBirthLeaf, sparkplugBirthUpperBound } from '../runtime/birth-size'
import { describeMqttSource, type MqttSourceModel } from './source-model'
import { isValidMqttSource, type MqttProjectIssue, mqttSelectionDestination } from './validate'

export interface MqttSelectionSummary {
  /** Leaves the integration selects (every selection is one leaf). */
  selectedLeaves: number
  /** Selections whose declared type is a publishable leaf. */
  resolvedLeaves: number
  /** Leaves behind a library block whose definition is not loaded; checked against the compiled program only. */
  unverifiedLeaves: number
  /** NBIRTH upper bound for Sparkplug when every selection resolved; null otherwise. */
  birthUpperBoundBytes: number | null
  issues: MqttProjectIssue[]
}

/** Pre-compile check of every selection against the project's declarations. */
export const summarizeMqttSelections = (
  integration: MqttProjectIntegrationV1,
  model: MqttSourceModel,
): MqttSelectionSummary => {
  const issues: MqttProjectIssue[] = []
  const birthLeaves: SparkplugBirthLeaf[] = []
  let resolvedLeaves = 0
  let unverifiedLeaves = 0
  let complete = true
  integration.selections.forEach((selection, index) => {
    const pointer = `/selections/${index}/source/tokens`
    if (!isValidMqttSource(selection.source.tokens)) {
      complete = false
      return
    }
    const description = describeMqttSource(model, selection.source.tokens)
    switch (description.status) {
      case 'leaf': {
        resolvedLeaves += 1
        const destination = mqttSelectionDestination(integration, selection)
        if (destination === null) complete = false
        else birthLeaves.push({ destination, iecType: description.iecType, size: description.size })
        return
      }
      case 'opaque':
        unverifiedLeaves += 1
        complete = false
        return
      case 'unsupported':
        complete = false
        issues.push({
          code: 'config_type_unsupported',
          pointer,
          message: `Type "${description.typeName}" cannot be published.`,
          detail: description.reason,
        })
        return
      case 'container':
        complete = false
        issues.push({
          code: 'project_selection_unresolved',
          pointer,
          message: 'Selection points to a structure, block or array instead of a single value.',
          detail: 'not_a_leaf',
        })
        return
      case 'missing':
        complete = false
        issues.push({
          code: 'project_selection_unresolved',
          pointer,
          message: 'Selection no longer matches a variable of the program. Repair or remove it.',
          detail: description.reason,
        })
        return
    }
  })

  let birthUpperBoundBytes: number | null = null
  if (integration.mode === 'sparkplug_b' && complete) {
    birthUpperBoundBytes = sparkplugBirthUpperBound(birthLeaves)
    if (birthUpperBoundBytes > MQTT_LIMITS.maxPayloadBytes) {
      issues.push({
        code: 'config_payload_too_large',
        pointer: '/selections',
        message: `The Sparkplug birth message can reach ${birthUpperBoundBytes} bytes; the limit is ${MQTT_LIMITS.maxPayloadBytes}.`,
      })
    }
  }
  return {
    selectedLeaves: integration.selections.length,
    resolvedLeaves,
    unverifiedLeaves,
    birthUpperBoundBytes,
    issues,
  }
}
