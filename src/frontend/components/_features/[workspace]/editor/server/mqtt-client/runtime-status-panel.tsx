import type { ReactNode } from 'react'

import type { MqttRuntimeStatusV1 } from '../../../../../../utils/mqtt/runtime/status'
import { MQTT_ERROR_CATEGORY_LABELS, MQTT_RUNTIME_STATE_LABELS } from '../../../../../../utils/mqtt/ui/presentation'
import { hintClass, labelClass } from './fields'
import type { MqttRuntimeView } from './use-mqtt-runtime-status'

const VIEW_TEXT: Readonly<Record<Exclude<MqttRuntimeView['kind'], 'ready' | 'error'>, string>> = {
  unsupported: 'This connection cannot read the MQTT state of the runtime.',
  no_target: 'No target runtime is selected.',
  offline: 'Not connected to the runtime. Connect to it to see the MQTT state.',
  loading: 'Reading the MQTT state of the runtime...',
  invalid: 'The runtime answered with an MQTT state this version does not understand.',
}

const Row = ({ name, children }: { name: string; children: ReactNode }) => (
  <div className='flex gap-2'>
    <dt className='w-40 shrink-0 text-neutral-600 dark:text-neutral-400'>{name}</dt>
    <dd className='break-all'>{children}</dd>
  </div>
)

const StatusDetails = ({ status }: { status: MqttRuntimeStatusV1 }) => (
  <dl className='flex flex-col gap-1 font-caption text-xs' aria-label='Runtime MQTT state'>
    <Row name='State'>
      <span data-testid='mqtt-runtime-state' data-state={status.state}>
        {MQTT_RUNTIME_STATE_LABELS[status.state]}
      </span>{' '}
      <span className={hintClass}>since {status.since}</span>
    </Row>
    {status.mode !== undefined && <Row name='Mode'>{status.mode === 'generic' ? 'Generic MQTT' : 'Sparkplug B'}</Row>}
    {status.broker !== undefined && (
      <Row name='Broker'>
        {status.broker.host}:{status.broker.port} {status.broker.tls ? '(TLS)' : '(plaintext, not encrypted)'}
      </Row>
    )}
    {status.error !== null && (
      <Row name='Error'>
        <span data-testid='mqtt-runtime-error-category' data-category={status.error.category} className='text-red-500'>
          {MQTT_ERROR_CATEGORY_LABELS[status.error.category]}
        </span>
        {': '}
        {status.error.message}{' '}
        <span className={hintClass}>
          ({status.error.code}, {status.error.count}x since {status.error.since})
        </span>
      </Row>
    )}
    {status.reconnect !== undefined && status.reconnect.attempt > 0 && (
      <Row name='Reconnection'>
        attempt {status.reconnect.attempt}
        {status.reconnect.nextRetryInMs !== null
          ? `, next in ${Math.ceil(status.reconnect.nextRetryInMs / 1000)} s`
          : ''}
      </Row>
    )}
    {status.stats !== undefined && (
      <>
        <Row name='Leaves'>{status.stats.leaves}</Row>
        <Row name='Messages'>
          {status.stats.published} forwarded, {status.stats.dropped} dropped, {status.stats.readErrors} read errors
        </Row>
        <Row name='Last forwarded'>{status.stats.lastForwardedAt ?? 'never'}</Row>
      </>
    )}
    {status.sparkplug !== undefined && (
      <Row name='Sparkplug session'>
        bdSeq {status.sparkplug.bdSeq}, seq {status.sparkplug.seq}, last birth {status.sparkplug.lastBirthAt ?? 'never'}
      </Row>
    )}
    {status.programMd5 !== undefined && <Row name='Program'>{status.programMd5}</Row>}
  </dl>
)

export const RuntimeStatusPanel = ({ view }: { view: MqttRuntimeView }) => (
  <section
    aria-label='Runtime MQTT status'
    className='flex flex-col gap-2'
    data-testid='mqtt-runtime-view'
    data-kind={view.kind}
  >
    <h4 className={labelClass}>Runtime</h4>
    {view.kind === 'ready' ? (
      <StatusDetails status={view.status} />
    ) : view.kind === 'error' ? (
      <p className='font-caption text-xs text-red-500'>Could not read the MQTT state of the runtime: {view.message}</p>
    ) : (
      <p className={hintClass}>{VIEW_TEXT[view.kind]}</p>
    )}
  </section>
)
