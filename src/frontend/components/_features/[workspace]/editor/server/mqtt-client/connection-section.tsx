import type { MqttProjectIntegrationV1 } from '../../../../../../utils/mqtt/contract/contract'
import type { MqttProjectIssue } from '../../../../../../utils/mqtt/project/validate'
import { hintClass, IntegerField, IssueList, TextField } from './fields'

interface ConnectionSectionProps {
  integration: MqttProjectIntegrationV1
  issues: readonly MqttProjectIssue[]
  commit: (next: MqttProjectIntegrationV1) => void
}

export const ConnectionSection = ({ integration, issues, commit }: ConnectionSectionProps) => {
  const { connection } = integration
  const setConnection = (patch: Partial<Pick<MqttProjectIntegrationV1['connection'], 'host' | 'port' | 'clientId'>>) =>
    commit({ ...integration, connection: { ...connection, ...patch } })
  return (
    <div className='flex max-w-xl flex-col gap-4'>
      <p className={hintClass}>
        The runtime connects to this broker as an MQTT 3.1.1 client with a clean session. The broker is not part of the
        PLC and must be reachable from the runtime.
      </p>
      <TextField
        id='mqtt-host'
        label='Broker host'
        value={connection.host}
        placeholder='broker.example.net'
        onCommit={(host) => setConnection({ host })}
      />
      <IntegerField
        id='mqtt-port'
        label='Broker port'
        value={connection.port}
        hint={
          connection.tls.enabled ? 'MQTT over TLS usually listens on 8883.' : 'Plaintext MQTT usually listens on 1883.'
        }
        onCommit={(port) => setConnection({ port })}
      />
      <TextField
        id='mqtt-client-id'
        label='Client ID'
        value={connection.clientId}
        hint='Letters, digits, ".", "_" or "-", up to 64 characters. It also names the default topic prefix.'
        onCommit={(clientId) => setConnection({ clientId })}
      />
      <IssueList issues={issues} label='Connection issues' />
    </div>
  )
}
