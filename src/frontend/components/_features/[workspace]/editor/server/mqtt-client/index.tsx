import { useCallback, useMemo, useState } from 'react'

import type { MqttCredentialScope } from '../../../../../../../middleware/shared/ports/mqtt-credential-port'
import {
  useMqttCredentialStore,
  useRuntime,
  useRuntimeIdentity,
} from '../../../../../../../middleware/shared/providers'
import { resolveTargetCapabilities } from '../../../../../../../middleware/shared/utils/target-capabilities'
import { useOpenPLCStore } from '../../../../../../store'
import { cn } from '../../../../../../utils/cn'
import type { MqttProjectIntegrationV1 } from '../../../../../../utils/mqtt/contract/contract'
import { summarizeMqttSelections } from '../../../../../../utils/mqtt/project/selection-summary'
import { mqttSourceModelFromPortProject } from '../../../../../../utils/mqtt/project/source-model'
import {
  evaluateMqttCredentialState,
  mqttCredentialBinding,
  mqttTargetKey,
} from '../../../../../../utils/mqtt/ui/credential-state'
import { collectMqttEditorIssues, groupMqttIssues } from '../../../../../../utils/mqtt/ui/editor-issues'
import type { MqttEditorSection } from '../../../../../../utils/mqtt/ui/presentation'
import { ToggleSwitch } from '../../../../../_atoms/toggle-switch'
import { ConnectionSection } from './connection-section'
import { hintClass, IssueList, labelClass } from './fields'
import { PublicationSection } from './publication-section'
import { RuntimeStatusPanel } from './runtime-status-panel'
import { SecuritySection } from './security-section'
import { useMqttCredential } from './use-mqtt-credential'
import { useMqttRuntimeStatus } from './use-mqtt-runtime-status'
import { VariablesSection } from './variables-section'

type TabId = Exclude<MqttEditorSection, 'general'> | 'status'

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'connection', label: 'Connection' },
  { id: 'security', label: 'Security' },
  { id: 'publication', label: 'Publication' },
  { id: 'variables', label: 'Variables' },
  { id: 'status', label: 'Status' },
]

export const MqttClientEditor = () => {
  const editor = useOpenPLCStore((s) => s.editor)
  const projectPath = useOpenPLCStore((s) => s.project.meta.path)
  const projectData = useOpenPLCStore((s) => s.project.data)
  const systemLibraries = useOpenPLCStore((s) => s.libraries.system)
  const deviceBoard = useOpenPLCStore((s) => s.deviceDefinitions.configuration.deviceBoard)
  const runtimeIpAddress = useOpenPLCStore((s) => s.deviceDefinitions.configuration.runtimeIpAddress)
  const availableBoards = useOpenPLCStore((s) => s.deviceAvailableOptions.availableBoards)
  const selectedDevice = useOpenPLCStore((s) => s.runtimeConnection.selectedDevice)
  const connectionStatus = useOpenPLCStore((s) => s.runtimeConnection.connectionStatus)
  const updateMqttServerConfig = useOpenPLCStore((s) => s.projectActions.updateMqttServerConfig)
  const markUnsaved = useOpenPLCStore((s) => s.sharedWorkspaceActions.handleFileAndWorkspaceSavedState)
  const runtime = useRuntime()
  const credentialStore = useMqttCredentialStore()
  const runtimeIdentity = useRuntimeIdentity()

  const [tab, setTab] = useState<TabId>('connection')
  const [commitError, setCommitError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  const serverName = editor.type === 'plc-server' ? editor.meta.name : ''
  const servers = projectData.servers
  const integration = servers?.find((s) => s.name === serverName && s.protocol === 'mqtt')?.mqttConfig

  const model = useMemo(
    () =>
      mqttSourceModelFromPortProject(
        {
          pous: projectData.pous,
          dataTypes: projectData.dataTypes,
          globalVariableLists: projectData.globalVariableLists,
          configurations: projectData.configurations,
        },
        systemLibraries,
      ),
    [
      projectData.pous,
      projectData.dataTypes,
      projectData.globalVariableLists,
      projectData.configurations,
      systemLibraries,
    ],
  )

  const targetKey = mqttTargetKey({ selectedDevice, runtimeIpAddress })
  const scope = useMemo<MqttCredentialScope | null>(
    () => (targetKey === null ? null : { projectKey: projectPath, targetKey, serverName }),
    [projectPath, targetKey, serverName],
  )
  const credential = useMqttCredential(credentialStore, scope)
  const runtimeView = useMqttRuntimeStatus({
    runtime,
    contextKey: scope === null ? null : JSON.stringify([scope.projectKey, scope.targetKey, scope.serverName]),
    connected: connectionStatus === 'connected',
  })

  const commit = useCallback(
    (next: MqttProjectIntegrationV1) => {
      const result = updateMqttServerConfig(serverName, next)
      if (!result.ok) {
        setCommitError(result.message ?? 'The change was not applied.')
        return
      }
      setCommitError(null)
      markUnsaved(serverName)
    },
    [updateMqttServerConfig, markUnsaved, serverName],
  )

  if (!integration) {
    return (
      <div className='flex h-full w-full items-center justify-center'>
        <p className='text-neutral-500 dark:text-neutral-400'>MQTT configuration for {serverName} was not found.</p>
      </div>
    )
  }

  const target = resolveTargetCapabilities(availableBoards.get(deviceBoard))
  const summary = summarizeMqttSelections(integration, model)
  const credentialBinding = mqttCredentialBinding(integration)
  const credentialState = evaluateMqttCredentialState({
    integration,
    targetKey,
    local: credential.presence,
    runtimeActive: runtimeView.kind === 'ready' ? (runtimeView.credentials?.active ?? null) : null,
  })
  const issues = groupMqttIssues(
    collectMqttEditorIssues({ serverName, integration, servers, target, summary, credential: credentialState }),
  )
  const issueCount = (id: TabId): number => (id === 'status' ? 0 : issues[id].length)

  return (
    <div aria-label='MQTT client editor' className='flex h-full w-full flex-col overflow-hidden p-4'>
      <div className='mb-3 flex flex-wrap items-start justify-between gap-4'>
        <div>
          <h2 className='text-lg font-semibold text-neutral-1000 dark:text-neutral-100'>MQTT client: {serverName}</h2>
          <p className='max-w-2xl text-sm text-neutral-600 dark:text-neutral-400'>
            The runtime connects to an external MQTT broker and publishes the selected PLC values. No broker runs on the
            PLC, and nothing received over MQTT writes to the program.
          </p>
        </div>
        <div className='flex items-center gap-3'>
          <span
            className={cn(hintClass, 'rounded-md border px-2 py-1')}
            data-testid='mqtt-transport-badge'
            data-transport={integration.connection.tls.enabled ? 'tls' : 'plaintext'}
          >
            {integration.connection.tls.enabled ? 'TLS' : 'Plaintext (not encrypted)'}
          </span>
          <ToggleSwitch
            id='mqtt-enabled'
            aria-label='Enable MQTT integration'
            checked={integration.enabled}
            onCheckedChange={(enabled) => commit({ ...integration, enabled })}
          />
          <label htmlFor='mqtt-enabled' className={labelClass}>
            Enabled
          </label>
        </div>
      </div>
      {commitError !== null && (
        <p role='alert' className='mb-2 font-caption text-xs text-red-500'>
          {commitError}
        </p>
      )}
      <IssueList issues={issues.general} label='Integration issues' />

      <div
        role='tablist'
        aria-label='MQTT settings'
        className='mt-2 flex shrink-0 border-b border-neutral-200 dark:border-neutral-700'
      >
        {TABS.map(({ id, label }) => {
          const count = issueCount(id)
          return (
            <button
              key={id}
              type='button'
              role='tab'
              id={`mqtt-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`mqtt-panel-${id}`}
              onClick={() => setTab(id)}
              className={cn(
                'border-b-2 border-transparent px-4 py-2 font-caption text-xs font-medium',
                tab === id
                  ? 'border-brand-medium text-brand-medium dark:border-brand-light dark:text-brand-light'
                  : 'text-neutral-500 dark:text-neutral-400',
              )}
            >
              {label}
              {id === 'variables' ? ` (${summary.selectedLeaves})` : ''}
              {count > 0 && <span className='ml-1 text-red-500'>!{count}</span>}
            </button>
          )
        })}
      </div>

      <div
        role='tabpanel'
        id={`mqtt-panel-${tab}`}
        aria-labelledby={`mqtt-tab-${tab}`}
        className='flex min-h-0 flex-1 flex-col overflow-auto pt-4'
      >
        {tab === 'connection' && (
          <ConnectionSection integration={integration} issues={issues.connection} commit={commit} />
        )}
        {tab === 'security' && (
          <SecuritySection
            integration={integration}
            issues={issues.security}
            commit={commit}
            credentialBinding={credentialBinding}
            credentialState={credentialState}
            persistence={credentialStore.persistence}
            onSaveCredential={credential.save}
            onRemoveCredential={credential.remove}
            runtimeIdentity={runtimeIdentity}
            targetKey={targetKey}
          />
        )}
        {tab === 'publication' && (
          <PublicationSection integration={integration} issues={issues.publication} commit={commit} />
        )}
        {tab === 'variables' && (
          <VariablesSection
            expanded={expanded}
            onExpandedChange={setExpanded}
            integration={integration}
            model={model}
            summary={summary}
            issues={issues.variables}
            commit={commit}
          />
        )}
        {tab === 'status' && <RuntimeStatusPanel view={runtimeView} />}
      </div>
    </div>
  )
}
