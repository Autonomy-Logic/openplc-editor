import { MQTT_LIMITS, type MqttProjectIntegrationV1 } from '../../../../../../utils/mqtt/contract/contract'
import { defaultTopicPrefix } from '../../../../../../utils/mqtt/contract/names'
import type { MqttProjectIssue } from '../../../../../../utils/mqtt/project/validate'
import { ToggleSwitch } from '../../../../../_atoms/toggle-switch'
import { hintClass, inputClass, IntegerField, IssueList, labelClass, TextField } from './fields'

interface PublicationSectionProps {
  integration: MqttProjectIntegrationV1
  issues: readonly MqttProjectIssue[]
  commit: (next: MqttProjectIntegrationV1) => void
}

const INTERVAL_HINT = `${MQTT_LIMITS.minIntervalMs} to ${MQTT_LIMITS.maxIntervalMs} ms.`

export const PublicationSection = ({ integration, issues, commit }: PublicationSectionProps) => {
  const { generic, sparkplug } = integration
  const setGeneric = (patch: Partial<MqttProjectIntegrationV1['generic']>) =>
    commit({ ...integration, generic: { ...generic, ...patch } })
  const setSparkplug = (patch: Partial<MqttProjectIntegrationV1['sparkplug']>) =>
    commit({ ...integration, sparkplug: { ...sparkplug, ...patch } })

  return (
    <div className='flex max-w-xl flex-col gap-4'>
      <div className='flex flex-col gap-1'>
        <label htmlFor='mqtt-mode' className={labelClass}>
          Mode
        </label>
        <select
          id='mqtt-mode'
          className={inputClass}
          value={integration.mode}
          onChange={(e) =>
            commit({ ...integration, mode: e.target.value === 'sparkplug_b' ? 'sparkplug_b' : 'generic' })
          }
        >
          <option value='generic'>Generic MQTT (one JSON topic per value)</option>
          <option value='sparkplug_b'>Sparkplug B (Edge Node metrics)</option>
        </select>
      </div>

      {integration.mode === 'generic' ? (
        <>
          <div className='flex flex-col gap-1'>
            <label htmlFor='mqtt-publish-mode' className={labelClass}>
              Publish
            </label>
            <select
              id='mqtt-publish-mode'
              className={inputClass}
              value={generic.publishMode}
              onChange={(e) => setGeneric({ publishMode: e.target.value === 'periodic' ? 'periodic' : 'on_change' })}
            >
              <option value='on_change'>On change (compares sampled values)</option>
              <option value='periodic'>Periodically (every value at a fixed interval)</option>
            </select>
            <span className={hintClass}>
              Payload is exactly {'{"value": ...}'}. On change does not capture transitions shorter than the sample
              interval.
            </span>
          </div>
          {generic.publishMode === 'on_change' ? (
            <IntegerField
              id='mqtt-sample-interval'
              label='Sample interval (ms)'
              value={generic.sampleIntervalMs}
              hint={INTERVAL_HINT}
              onCommit={(sampleIntervalMs) => setGeneric({ sampleIntervalMs })}
            />
          ) : (
            <IntegerField
              id='mqtt-publish-interval'
              label='Publish interval (ms)'
              value={generic.publishIntervalMs}
              hint={INTERVAL_HINT}
              onCommit={(publishIntervalMs) => setGeneric({ publishIntervalMs })}
            />
          )}
          <div className='flex flex-col gap-1'>
            <label htmlFor='mqtt-qos' className={labelClass}>
              QoS
            </label>
            <select
              id='mqtt-qos'
              className={inputClass}
              value={generic.qos}
              onChange={(e) => setGeneric({ qos: e.target.value === '1' ? 1 : 0 })}
            >
              <option value='0'>0 - at most once</option>
              <option value='1'>1 - at least once</option>
            </select>
          </div>
          <div className='flex items-center gap-3'>
            <ToggleSwitch
              id='mqtt-retain'
              aria-label='Retain messages'
              checked={generic.retain}
              onCheckedChange={(retain) => setGeneric({ retain })}
            />
            <label htmlFor='mqtt-retain' className={labelClass}>
              Retain messages
            </label>
          </div>
          <TextField
            id='mqtt-topic-prefix'
            label='Topic prefix'
            value={generic.topicPrefix ?? ''}
            placeholder={defaultTopicPrefix(integration.connection.clientId)}
            hint='Leave empty to use openplc/<client ID>.'
            onCommit={(value) => {
              const { topicPrefix: _previous, ...rest } = generic
              commit({ ...integration, generic: value === '' ? rest : { ...rest, topicPrefix: value } })
            }}
          />
        </>
      ) : (
        <>
          <TextField
            id='mqtt-group-id'
            label='Group ID'
            value={sparkplug.groupId}
            onCommit={(groupId) => setSparkplug({ groupId })}
          />
          <TextField
            id='mqtt-edge-node-id'
            label='Edge Node ID'
            value={sparkplug.edgeNodeId}
            hint='Kept the same across reconnections.'
            onCommit={(edgeNodeId) => setSparkplug({ edgeNodeId })}
          />
          <IntegerField
            id='mqtt-sparkplug-sample-interval'
            label='Sample interval (ms)'
            value={sparkplug.sampleIntervalMs}
            hint={INTERVAL_HINT}
            onCommit={(sampleIntervalMs) => setSparkplug({ sampleIntervalMs })}
          />
          <p className={hintClass}>
            Sparkplug B defines its own delivery: births and data use QoS 0 without retain, and the death certificate
            uses QoS 1. The runtime answers only the Rebirth command; process values cannot be written from MQTT.
          </p>
        </>
      )}
      <IssueList issues={issues} label='Publication issues' />
    </div>
  )
}
