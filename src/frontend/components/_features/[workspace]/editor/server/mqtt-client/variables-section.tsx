import { useEffect, useMemo, useState } from 'react'

import {
  MQTT_LIMITS,
  type MqttMode,
  type MqttProjectIntegrationV1,
} from '../../../../../../utils/mqtt/contract/contract'
import type { MqttSelectionSummary } from '../../../../../../utils/mqtt/project/selection-summary'
import {
  buildMqttSourceTree,
  countMqttLeaves,
  describeMqttSource,
  mqttArrayElements,
  mqttSourceKey,
  type MqttSourceModel,
  type MqttTreeNode,
} from '../../../../../../utils/mqtt/project/source-model'
import { type MqttProjectIssue, mqttSelectionDestination } from '../../../../../../utils/mqtt/project/validate'
import {
  mqttEncodingLabel,
  mqttIssueSelectionIndex,
  mqttMissingReasonText,
  mqttSourceDisplayPath,
  mqttUnsupportedReasonText,
} from '../../../../../../utils/mqtt/ui/presentation'
import {
  clearMqttSubtree,
  countMqttSelectedUnder,
  mqttSelectedKeys,
  removeMqttSelection,
  selectMqttSubtree,
  setMqttSelectionDestination,
  toggleMqttLeafSelection,
} from '../../../../../../utils/mqtt/ui/selection'
import { buttonClass, hintClass, inputClass, IssueList } from './fields'

const ARRAY_PAGE = 32
const SELECTED_PAGE = 100

interface VariablesSectionProps {
  expanded: ReadonlySet<string>
  onExpandedChange: (next: ReadonlySet<string>) => void
  integration: MqttProjectIntegrationV1
  model: MqttSourceModel
  summary: MqttSelectionSummary
  issues: readonly MqttProjectIssue[]
  commit: (next: MqttProjectIntegrationV1) => void
}

interface TreeContext {
  model: MqttSourceModel
  integration: MqttProjectIntegrationV1
  selected: ReadonlySet<string>
  expanded: ReadonlySet<string>
  toggleExpanded: (id: string) => void
  apply: (change: ReturnType<typeof toggleMqttLeafSelection>) => void
}

const typeText = (node: MqttTreeNode): string => {
  switch (node.kind) {
    case 'leaf':
      return node.iecType
    case 'array':
      return `ARRAY[${node.dimensions.map((d) => `${d.lower}..${d.upper}`).join(', ')}] (${node.elementCount} elements)`
    case 'composite':
    case 'opaque':
    case 'unsupported':
      return node.typeName
    default:
      return node.scope === 'instance' ? `program ${node.program ?? ''}` : 'global variables'
  }
}

const ContainerActions = ({ node, context }: { node: MqttTreeNode; context: TreeContext }) => {
  const path = mqttSourceDisplayPath(node.tokens)
  const total = countMqttLeaves(context.model, node)
  const selectedUnder = countMqttSelectedUnder(context.integration, node.tokens)
  return (
    <span className='ml-auto flex items-center gap-2'>
      <span className={hintClass}>
        {selectedUnder}/{total} selected
      </span>
      <button
        type='button'
        className={buttonClass}
        disabled={total === 0}
        aria-label={`Select all leaves under ${path}`}
        onClick={() => context.apply(selectMqttSubtree(context.model, context.integration, node))}
      >
        Select all
      </button>
      {selectedUnder > 0 && (
        <button
          type='button'
          className={buttonClass}
          aria-label={`Clear selection under ${path}`}
          onClick={() => context.apply(clearMqttSubtree(context.integration, node.tokens))}
        >
          Clear
        </button>
      )}
    </span>
  )
}

const ArrayElements = ({ node, context }: { node: Extract<MqttTreeNode, { kind: 'array' }>; context: TreeContext }) => {
  const [shown, setShown] = useState(ARRAY_PAGE)
  const elements = mqttArrayElements(context.model, node, 0, shown)
  return (
    <ul className='ml-4 flex flex-col'>
      {elements.map((element) => (
        <TreeRow key={element.id} node={element} context={context} />
      ))}
      {shown < node.elementCount && (
        <li>
          <button type='button' className={buttonClass} onClick={() => setShown(shown + ARRAY_PAGE)}>
            Show more elements ({node.elementCount - shown} hidden)
          </button>
        </li>
      )}
    </ul>
  )
}

const TreeRow = ({ node, context }: { node: MqttTreeNode; context: TreeContext }) => {
  const path = mqttSourceDisplayPath(node.tokens)
  const rowClass = 'flex min-h-[28px] items-center gap-2 font-caption text-xs text-neutral-900 dark:text-neutral-200'

  if (node.kind === 'leaf') {
    const checked = context.selected.has(mqttSourceKey(node.tokens))
    return (
      <li className={rowClass} data-node-kind='leaf'>
        <input
          type='checkbox'
          aria-label={`Select ${path}`}
          checked={checked}
          onChange={() => context.apply(toggleMqttLeafSelection(context.integration, node.tokens))}
        />
        <span className='font-medium'>{node.label}</span>
        <span className={hintClass}>{node.iecType}</span>
        <span className={hintClass}>{mqttEncodingLabel(node.iecType, context.integration.mode)}</span>
      </li>
    )
  }
  if (node.kind === 'unsupported' || node.kind === 'opaque') {
    return (
      <li className={rowClass} data-node-kind={node.kind} aria-disabled='true'>
        <span className='font-medium opacity-60'>{node.label}</span>
        <span className={hintClass}>{node.typeName}</span>
        <span className={hintClass}>
          Not selectable:{' '}
          {node.kind === 'unsupported'
            ? mqttUnsupportedReasonText(node.reason)
            : 'the library block definition is not loaded, so its fields are unknown.'}
        </span>
      </li>
    )
  }
  const open = context.expanded.has(node.id)
  return (
    <li className='flex flex-col' data-node-kind={node.kind}>
      <div className={rowClass}>
        <button
          type='button'
          className='w-4 text-neutral-600'
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${path}`}
          onClick={() => context.toggleExpanded(node.id)}
        >
          {open ? '-' : '+'}
        </button>
        <span className='font-medium'>{node.label}</span>
        <span className={hintClass}>{typeText(node)}</span>
        <ContainerActions node={node} context={context} />
      </div>
      {open && node.kind === 'array' && <ArrayElements node={node} context={context} />}
      {open && node.kind !== 'array' && (
        <ul className='ml-4 flex flex-col'>
          {node.children.map((child) => (
            <TreeRow key={child.id} node={child} context={context} />
          ))}
        </ul>
      )}
    </li>
  )
}

const DestinationInput = ({
  index,
  value,
  placeholder,
  label,
  onCommit,
}: {
  index: number
  value: string
  placeholder: string
  label: string
  onCommit: (index: number, value: string) => void
}) => {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      type='text'
      aria-label={label}
      autoComplete='off'
      spellCheck={false}
      className={inputClass}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(index, draft)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

const destinationOf = (integration: MqttProjectIntegrationV1, index: number): string | undefined => {
  const selection = integration.selections[index]
  return integration.mode === 'generic' ? selection.topic : selection.metricName
}

const destinationLabel = (mode: MqttMode): string => (mode === 'generic' ? 'Topic' : 'Metric name')

export const VariablesSection = ({
  expanded,
  onExpandedChange,
  integration,
  model,
  summary,
  issues,
  commit,
}: VariablesSectionProps) => {
  const tree = useMemo(() => buildMqttSourceTree(model), [model])
  const selected = useMemo(() => mqttSelectedKeys(integration), [integration])
  const [refusal, setRefusal] = useState<string | null>(null)
  const [rowLimit, setRowLimit] = useState(SELECTED_PAGE)
  const [onlyProblems, setOnlyProblems] = useState(false)
  const descriptions = useMemo(
    () => integration.selections.map((s) => describeMqttSource(model, s.source.tokens)),
    [integration, model],
  )

  const context: TreeContext = {
    model,
    integration,
    selected,
    expanded,
    toggleExpanded: (id) => {
      const next = new Set(expanded)
      if (!next.delete(id)) next.add(id)
      onExpandedChange(next)
    },
    apply: (change) => {
      if (!change.ok) {
        setRefusal(change.message)
        return
      }
      setRefusal(null)
      if (change.changed > 0) commit(change.integration)
    },
  }

  const rowIssues = new Map<number, MqttProjectIssue[]>()
  const generalIssues: MqttProjectIssue[] = []
  for (const issue of issues) {
    const index = mqttIssueSelectionIndex(issue.pointer)
    if (index === null) generalIssues.push(issue)
    else rowIssues.set(index, [...(rowIssues.get(index) ?? []), issue])
  }

  const label = destinationLabel(integration.mode)
  const hasProblem = (index: number): boolean => {
    const { status } = descriptions[index]
    return (status !== 'leaf' && status !== 'opaque') || rowIssues.has(index)
  }
  const problemCount = integration.selections.filter((_, index) => hasProblem(index)).length
  const listed = integration.selections
    .map((selection, index) => ({ selection, index }))
    .filter(({ index }) => !onlyProblems || hasProblem(index))
  const shown = listed.slice(0, rowLimit)

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-3'>
      <div className='flex flex-wrap items-center gap-4 font-caption text-xs' data-testid='mqtt-selection-summary'>
        <span>
          <span data-testid='mqtt-selected-count'>{summary.selectedLeaves}</span> of {MQTT_LIMITS.maxLeaves} leaves
          selected
        </span>
        {summary.unverifiedLeaves > 0 && (
          <span className={hintClass}>
            {summary.unverifiedLeaves} inside library blocks are checked only against the compiled program.
          </span>
        )}
        {integration.mode === 'sparkplug_b' && summary.birthUpperBoundBytes !== null && (
          <span data-testid='mqtt-birth-size'>
            Birth message up to {summary.birthUpperBoundBytes} of {MQTT_LIMITS.maxPayloadBytes} bytes
          </span>
        )}
      </div>
      {refusal !== null && (
        <p role='alert' className='font-caption text-xs text-red-500'>
          {refusal}
        </p>
      )}
      <IssueList issues={generalIssues} label='Variable selection issues' />
      <div className='grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-2'>
        <section
          aria-label='Program variables'
          className='min-h-0 overflow-auto rounded-md border p-2 dark:border-neutral-700'
        >
          {tree.length === 0 ? (
            <p className={hintClass}>The project has no program instances or global variables to publish.</p>
          ) : (
            <ul className='flex flex-col'>
              {tree.map((node) => (
                <TreeRow key={node.id} node={node} context={context} />
              ))}
            </ul>
          )}
        </section>
        <section
          aria-label='Selected leaves'
          className='min-h-0 overflow-auto rounded-md border p-2 dark:border-neutral-700'
        >
          {integration.selections.length > 0 && (
            <div className='mb-2 flex items-center gap-3 font-caption text-xs'>
              <label className='flex items-center gap-2'>
                <input type='checkbox' checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
                Only selections with problems ({problemCount})
              </label>
              <span className={hintClass} data-testid='mqtt-selection-shown'>
                Showing {shown.length} of {listed.length}
              </span>
            </div>
          )}
          {integration.selections.length === 0 ? (
            <p className={hintClass}>No leaves selected yet. Pick values in the tree.</p>
          ) : (
            <table className='w-full table-fixed font-caption text-xs'>
              <thead>
                <tr className='text-left'>
                  <th className='w-[32%] p-1'>Source</th>
                  <th className='w-[18%] p-1'>Type / encoding</th>
                  <th className='p-1'>{label}</th>
                  <th className='w-[72px] p-1' />
                </tr>
              </thead>
              <tbody>
                {shown.map(({ selection, index }) => {
                  const path = mqttSourceDisplayPath(selection.source.tokens)
                  const description = descriptions[index]
                  const ownIssues = rowIssues.get(index) ?? []
                  const fallback = mqttSelectionDestination(integration, { source: selection.source }) ?? ''
                  return (
                    <tr
                      key={`${mqttSourceKey(selection.source.tokens)}#${index}`}
                      data-testid='mqtt-selection-row'
                      data-invalid={hasProblem(index)}
                      className='border-t align-top dark:border-neutral-700'
                    >
                      <td className='break-all p-1'>{path}</td>
                      <td className='p-1'>
                        {description.status === 'leaf' ? (
                          <>
                            {description.iecType}
                            <div className={hintClass}>{mqttEncodingLabel(description.iecType, integration.mode)}</div>
                          </>
                        ) : description.status === 'missing' ? (
                          <span className='text-red-500'>Invalid: {mqttMissingReasonText(description.reason)}</span>
                        ) : description.status === 'unsupported' ? (
                          <span className='text-red-500'>{mqttUnsupportedReasonText(description.reason)}</span>
                        ) : description.status === 'container' ? (
                          <span className='text-red-500'>{mqttMissingReasonText('not_a_leaf')}</span>
                        ) : (
                          <span className={hintClass}>{description.typeName} (checked at compile time)</span>
                        )}
                      </td>
                      <td className='p-1'>
                        <DestinationInput
                          index={index}
                          value={destinationOf(integration, index) ?? ''}
                          placeholder={fallback}
                          label={`${label} for ${path}`}
                          onCommit={(i, value) => commit(setMqttSelectionDestination(integration, i, value))}
                        />
                        {ownIssues.map((issue) => (
                          <div
                            key={`${issue.code}:${issue.pointer}`}
                            className='mt-1 text-red-500'
                            data-issue-code={issue.code}
                          >
                            {issue.message}
                            {issue.detail !== undefined ? ` (${issue.detail})` : ''}
                          </div>
                        ))}
                      </td>
                      <td className='p-1'>
                        <button
                          type='button'
                          className={buttonClass}
                          aria-label={`Remove ${path}`}
                          onClick={() => commit(removeMqttSelection(integration, index))}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {shown.length < listed.length && (
            <button
              type='button'
              className={`${buttonClass} mt-2`}
              onClick={() => setRowLimit(rowLimit + SELECTED_PAGE)}
            >
              Show more selections ({listed.length - shown.length} hidden)
            </button>
          )}
        </section>
      </div>
    </div>
  )
}
