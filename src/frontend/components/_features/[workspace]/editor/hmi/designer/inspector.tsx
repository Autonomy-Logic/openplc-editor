/**
 * The selected element's properties by group: data, style, layout and actions. Each property shows its value as written
 * or the widget's default, and an edit goes back as ST text; an empty field removes the property.
 */
import { ToggleSwitch } from '@root/frontend/components/_atoms/toggle-switch'
import { cn } from '@root/frontend/utils/cn'
import type {
  HmiPlcVariable,
  HmiWidgetCatalog,
  HmiWidgetInfo,
  HmiWidgetProperty,
} from '@root/middleware/shared/ports/hmi-preview-types'
import {
  actionCode,
  actionOf,
  actionOfKind,
  HMI_ACTIONS,
  type HmiAction,
} from '@root/middleware/shared/utils/hmi/designer/designer-actions'
import {
  bindableVariables,
  momentaryCode,
  momentaryOf,
} from '@root/middleware/shared/utils/hmi/designer/designer-binding'
import { stString } from '@root/middleware/shared/utils/hmi/designer/designer-edits'
import {
  type DesignerElement,
  type DesignerModel,
  stringLiteralValue,
} from '@root/middleware/shared/utils/hmi/designer/designer-model'
import { useEffect, useState } from 'react'

import { DesignerSelect, Field, FIELD_CLASS } from './parts'

export interface InspectorActions {
  setProperty: (element: string, property: string, value: string | null) => void
  bind: (element: string, property: string, variable: string | null) => void
  setEvent: (element: string, event: string, code: string | null) => void
  rename: (element: string, newName: string) => void
  remove: (element: string) => void
}

const NONE = '__none__'
const same = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase()

/** A text field that commits on Enter or when it loses focus. */
function CommitField(props: {
  value: string
  placeholder?: string
  onCommit: (text: string) => void
  testId?: string
}) {
  const [text, setText] = useState(props.value)
  useEffect(() => setText(props.value), [props.value])
  const commit = () => {
    if (text !== props.value) props.onCommit(text)
  }
  return (
    <input
      className={FIELD_CLASS}
      value={text}
      placeholder={props.placeholder}
      data-testid={props.testId}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setText(props.value)
      }}
    />
  )
}

function PropertyEditor(props: {
  property: HmiWidgetProperty
  element: DesignerElement
  model: DesignerModel
  catalog: HmiWidgetCatalog
  onChange: (value: string | null) => void
}) {
  const { property, element } = props
  const written = element.props.find((p) => same(p.name, property.name))?.value
  const testId = `hmi-prop-${property.name}`
  switch (property.kind) {
    case 'bool': {
      const value = (written ?? property.defaultValue ?? 'FALSE').trim().toUpperCase() === 'TRUE'
      return (
        <ToggleSwitch
          checked={value}
          onCheckedChange={(on) => props.onChange(on ? 'TRUE' : 'FALSE')}
          aria-label={property.name}
        />
      )
    }
    case 'string': {
      const shown = written === undefined ? '' : (stringLiteralValue(written) ?? written)
      const placeholder = property.defaultValue
        ? (stringLiteralValue(property.defaultValue) ?? property.defaultValue)
        : ''
      return (
        <CommitField
          value={shown}
          placeholder={placeholder}
          testId={testId}
          onCommit={(text) => props.onChange(text === '' ? null : stString(text))}
        />
      )
    }
    case 'enum': {
      const members = property.enumMembers ?? []
      const current = written?.split('#').at(-1) ?? NONE
      return (
        <DesignerSelect
          value={members.find((m) => same(m, current)) ?? NONE}
          testId={testId}
          options={[
            {
              value: NONE,
              label: `Default${property.defaultValue ? ` (${property.defaultValue.split('#').at(-1)})` : ''}`,
            },
            ...members.map((m) => ({ value: m, label: m })),
          ]}
          onChange={(v) => props.onChange(v === NONE ? null : `${property.type}#${v}`)}
        />
      )
    }
    case 'color': {
      const named = props.catalog.colors.find((c) => written !== undefined && same(`COLOR.${c}`, written.trim()))
      const custom = written !== undefined && !named ? written.trim() : null
      const hex = custom?.match(/^16#([0-9A-F]{6})$/i)?.[1]
      return (
        <div className='flex gap-1'>
          <DesignerSelect
            value={named ?? (custom !== null ? '__custom__' : NONE)}
            testId={testId}
            options={[
              { value: NONE, label: 'Default' },
              ...props.catalog.colors.map((c) => ({ value: c, label: c })),
              { value: '__custom__', label: 'Custom' },
            ]}
            onChange={(v) => props.onChange(v === NONE ? null : v === '__custom__' ? '16#000000' : `COLOR.${v}`)}
          />
          {custom !== null && (
            <input
              type='color'
              aria-label={`${property.name} color`}
              className='h-[28px] w-10 cursor-pointer rounded-md border border-neutral-300 bg-white dark:border-neutral-850'
              value={`#${hex ?? '000000'}`}
              onChange={(e) => props.onChange(`16#${e.target.value.slice(1).toUpperCase()}`)}
            />
          )}
        </div>
      )
    }
    case 'elementRef': {
      const target = written === undefined ? null : stringLiteralValue(written)
      const others = props.model.elements.filter((e) => !same(e.name, element.name))
      return (
        <DesignerSelect
          value={others.find((e) => target !== null && same(e.name, target))?.name ?? NONE}
          testId={testId}
          options={[{ value: NONE, label: 'None' }, ...others.map((e) => ({ value: e.name, label: e.name }))]}
          onChange={(v) => props.onChange(v === NONE ? null : stString(v))}
        />
      )
    }
    default:
      return (
        <CommitField
          value={written ?? ''}
          placeholder={property.defaultValue ?? ''}
          testId={testId}
          onCommit={(text) => props.onChange(text.trim() === '' ? null : text.trim())}
        />
      )
  }
}

/** Inputs set by the designer itself rather than in the inspector. */
const MANAGED = new Set(['PARENT'])

export type PropertyTab = 'data' | 'style' | 'layout' | 'actions'

const TABS: ReadonlyArray<[PropertyTab, string]> = [
  ['data', 'Data'],
  ['style', 'Style'],
  ['layout', 'Layout'],
  ['actions', 'Actions'],
]

const Empty = ({ children }: { children: string }) => (
  <p className='font-caption text-xs text-neutral-700 dark:text-neutral-400'>{children}</p>
)

/** The selected element's properties, pinned to the canvas's top-right corner; collapses to its header. */
export function PropertiesCard(props: {
  model: DesignerModel
  element: DesignerElement
  catalog: HmiWidgetCatalog
  variables: readonly HmiPlcVariable[]
  screens: readonly string[]
  actions: InspectorActions
  locked: boolean
  onShowInCode: (element: string) => void
}) {
  const { element, catalog, actions } = props
  const [tab, setTab] = useState<PropertyTab>('data')
  const [collapsed, setCollapsed] = useState(false)
  const info: HmiWidgetInfo | undefined = catalog.widgets.get(element.type.toUpperCase())
  const binding = (property: string) =>
    props.model.bindings.find((b) => same(b.element, element.name) && same(b.property, property))?.variable
  const editable = (group: HmiWidgetProperty['group']) =>
    (info?.properties ?? []).filter(
      (p) => p.group === group && !MANAGED.has(p.name.toUpperCase()) && !(info?.main && same(info.main.name, p.name)),
    )
  const mainProperty = info?.main ? info.properties.find((p) => same(p.name, info.main?.name ?? '')) : undefined
  const row = (p: HmiWidgetProperty) => (
    <Field key={p.name} label={p.name} hint={`${p.type}${p.defaultValue ? ` = ${p.defaultValue}` : ''}`}>
      <PropertyEditor
        property={p}
        element={element}
        model={props.model}
        catalog={catalog}
        onChange={(value) => actions.setProperty(element.name, p.name, value)}
      />
    </Field>
  )
  const eventCode = (event: string) =>
    props.model.events.find((e) => same(e.element, element.name) && same(e.event, event))?.code ?? ''
  const momentary = info?.momentary
  const pressBinding = momentary ? momentaryOf(eventCode(momentary.changed), element.name, momentary) : null
  const mainBound = momentary ? pressBinding?.variable : info?.main ? binding(info.main.name) : undefined
  const bindMain = (variable: string | null, whilePressed = pressBinding?.whilePressed ?? true) => {
    if (!info?.main) return
    if (!momentary) return actions.bind(element.name, info.main.name, variable)
    actions.setEvent(
      element.name,
      momentary.changed,
      variable === null ? null : momentaryCode(element.name, momentary, { variable, whilePressed }),
    )
  }
  const content = (() => {
    switch (tab) {
      case 'data': {
        const rows = editable('data')
        if (!info?.main && rows.length === 0) return <Empty>This widget shows no data.</Empty>
        return (
          <>
            {info?.main && (
              <Field
                label={
                  momentary
                    ? 'Variable'
                    : info.twoWay
                      ? `${info.main.name} (the operator can change it)`
                      : info.main.name
                }
              >
                <DesignerSelect
                  value={mainBound ?? NONE}
                  testId='hmi-main-binding'
                  options={[
                    { value: NONE, label: 'Not bound' },
                    ...bindableVariables(info.main, props.variables).map((v) => ({
                      value: v.path,
                      label: `${v.path} : ${v.type}`,
                    })),
                  ]}
                  onChange={(v) => bindMain(v === NONE ? null : v)}
                />
              </Field>
            )}
            {momentary && pressBinding && (
              <Field label='Behavior'>
                <DesignerSelect
                  value={pressBinding.whilePressed ? 'true' : 'false'}
                  testId='hmi-main-press'
                  options={[
                    { value: 'true', label: 'Set to TRUE while pressed' },
                    { value: 'false', label: 'Set to FALSE while pressed' },
                  ]}
                  onChange={(v) => bindMain(pressBinding.variable, v === 'true')}
                />
              </Field>
            )}
            {mainBound === undefined && mainProperty && row(mainProperty)}
            {rows.map(row)}
          </>
        )
      }
      case 'style': {
        const rows = editable('display')
        return rows.length > 0 ? rows.map(row) : <Empty>This widget has no style properties.</Empty>
      }
      case 'layout': {
        const rows = editable('layout')
        return rows.length > 0 ? rows.map(row) : <Empty>This widget has no layout properties.</Empty>
      }
      case 'actions': {
        const events = info?.events ?? []
        if (events.length === 0) return <Empty>This widget has no actions.</Empty>
        return events.map((event) => (
          <ActionEditor
            key={event}
            event={event}
            code={eventCode(event)}
            screens={props.screens}
            variables={props.variables}
            onChange={(code) => actions.setEvent(element.name, event, code)}
          />
        ))
      }
      default: {
        const unhandled: never = tab
        return unhandled
      }
    }
  })()
  return (
    <div
      className='absolute right-3 top-3 z-10 flex max-h-[calc(100%-24px)] w-64 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_8px_24px_rgba(1,30,75,0.14)] dark:border-neutral-850 dark:bg-neutral-950'
      data-testid='hmi-inspector'
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className='flex shrink-0 items-center gap-2 bg-neutral-50 px-3 py-2 dark:bg-neutral-900'>
        <NameField
          value={element.name}
          disabled={props.locked || element.locked !== undefined}
          onCommit={(name) => actions.rename(element.name, name.trim())}
        />
        <span className='shrink-0 font-caption text-[11px] text-neutral-850 dark:text-neutral-400'>
          {(info?.name ?? element.type).replace(/^Hmi/i, '')}
        </span>
        <button
          type='button'
          aria-label={collapsed ? 'Expand the properties' : 'Collapse the properties'}
          data-testid='hmi-properties-collapse'
          onClick={() => setCollapsed(!collapsed)}
          className='flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-neutral-100 dark:hover:bg-neutral-850'
        >
          <svg
            width='13'
            height='13'
            viewBox='0 0 24 24'
            fill='none'
            strokeWidth='2.4'
            strokeLinecap='round'
            strokeLinejoin='round'
            className='stroke-neutral-850 dark:stroke-neutral-400'
            aria-hidden='true'
          >
            <path d={collapsed ? 'm6 9 6 6 6-6' : 'm18 15-6-6-6 6'} />
          </svg>
        </button>
      </div>
      {!collapsed && (
        <>
          {element.locked ? (
            <p
              className='p-3 font-caption text-xs text-neutral-850 dark:text-neutral-400'
              data-testid='hmi-inspector-locked'
            >
              {element.name} is edited in the code view: {element.locked}.
            </p>
          ) : (
            <>
              <div className='shrink-0 px-3 pt-2'>
                <div
                  role='tablist'
                  aria-label='Property groups'
                  className='flex gap-0.5 rounded-lg bg-neutral-100 p-[3px] dark:bg-neutral-900'
                >
                  {TABS.map(([t, label]) => (
                    <button
                      key={t}
                      role='tab'
                      type='button'
                      aria-selected={tab === t}
                      data-testid={`hmi-prop-tab-${t}`}
                      onClick={() => setTab(t)}
                      className={cn(
                        'h-6 flex-1 rounded-md font-caption text-[11px] text-neutral-850 dark:text-neutral-400',
                        tab === t && 'bg-white font-semibold text-brand-medium shadow-sm dark:bg-neutral-800',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className='min-h-0 flex-1 overflow-y-auto' data-testid='hmi-properties-body'>
                <fieldset disabled={props.locked} className='flex min-w-0 flex-col gap-2.5 p-3'>
                  {content}
                </fieldset>
              </div>
            </>
          )}
          <div className='flex shrink-0 items-center gap-2 border-t border-neutral-100 px-3 py-1.5 dark:border-neutral-850'>
            <button
              type='button'
              onClick={() => props.onShowInCode(element.name)}
              className='font-caption text-xs font-medium text-brand-medium hover:text-brand-medium-dark'
              data-testid='hmi-show-in-code'
            >
              Show in code
            </button>
            <div className='flex-1' />
            <button
              type='button'
              aria-label={`Delete ${element.name}`}
              title={`Delete ${element.name}`}
              data-testid='hmi-delete-element'
              disabled={props.locked}
              onClick={() => actions.remove(element.name)}
              className='flex h-6 w-6 items-center justify-center rounded hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-850'
            >
              <svg
                width='15'
                height='15'
                viewBox='0 0 24 24'
                fill='none'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
                className='stroke-neutral-700'
                aria-hidden='true'
              >
                <path d='M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3' />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** The element's name in the card's header, edited in place; commits on Enter or when it loses focus. */
function NameField(props: { value: string; disabled: boolean; onCommit: (name: string) => void }) {
  const [text, setText] = useState(props.value)
  useEffect(() => setText(props.value), [props.value])
  const commit = () => {
    if (text.trim() !== '' && text !== props.value) props.onCommit(text)
    else setText(props.value)
  }
  return (
    <input
      aria-label='Name'
      data-testid='hmi-element-name'
      value={text}
      disabled={props.disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        }
        if (e.key === 'Escape') setText(props.value)
      }}
      className='min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 font-display text-sm font-semibold text-neutral-1000 outline-none hover:border-neutral-300 focus:border-brand-medium-dark focus:bg-white dark:text-white dark:focus:bg-neutral-950'
    />
  )
}

/** One event's action: what kind it is, then what it needs (a screen, a variable and value, or ST code). */
function ActionEditor(props: {
  event: string
  code: string
  screens: readonly string[]
  variables: readonly HmiPlcVariable[]
  onChange: (code: string | null) => void
}) {
  const [action, setAction] = useState<HmiAction>(() => actionOf(props.code))
  useEffect(() => {
    const read = actionOf(props.code)
    setAction((draft) => (actionCode(draft) === actionCode(read) ? draft : read))
  }, [props.code])
  const change = (next: HmiAction) => {
    setAction(next)
    const code = actionCode(next)
    if (code !== null) props.onChange(code)
    else if (next.kind === 'none') props.onChange(null)
  }
  const variableOptions = (kind: 'set' | 'toggle') => [
    { value: NONE, label: 'Pick a variable' },
    ...props.variables
      .filter((v) => kind === 'set' || v.type.toUpperCase() === 'BOOL')
      .map((v) => ({ value: v.path, label: `${v.path} : ${v.type}` })),
  ]
  return (
    <div className='flex flex-col gap-1.5' data-testid={`hmi-event-${props.event}`}>
      <Field label={`When ${props.event}`}>
        <DesignerSelect
          value={action.kind}
          testId={`hmi-action-${props.event}`}
          options={HMI_ACTIONS.map((a) => ({ value: a.kind, label: a.label }))}
          onChange={(kind) => {
            const known = HMI_ACTIONS.find((a) => a.kind === kind)
            if (known) change(actionOfKind(known.kind, action))
          }}
        />
      </Field>
      {action.kind === 'show' && (
        <Field label='Screen'>
          <DesignerSelect
            value={props.screens.find((s) => same(s, action.screen)) ?? NONE}
            testId={`hmi-action-screen-${props.event}`}
            options={[{ value: NONE, label: 'Pick a screen' }, ...props.screens.map((s) => ({ value: s, label: s }))]}
            onChange={(screen) => screen !== NONE && change({ kind: 'show', screen })}
          />
        </Field>
      )}
      {(action.kind === 'set' || action.kind === 'toggle') && (
        <Field label='Variable'>
          <DesignerSelect
            value={props.variables.find((v) => same(v.path, action.variable))?.path ?? NONE}
            testId={`hmi-action-variable-${props.event}`}
            options={variableOptions(action.kind)}
            onChange={(variable) => variable !== NONE && change({ ...action, variable })}
          />
        </Field>
      )}
      {action.kind === 'set' && (
        <Field label='Value'>
          <CommitField
            value={action.value}
            placeholder='TRUE, 42, 1.5…'
            testId={`hmi-action-value-${props.event}`}
            onCommit={(value) => change({ ...action, value })}
          />
        </Field>
      )}
      {action.kind === 'code' && <EventCode code={action.code} onCommit={(code) => change({ kind: 'code', code })} />}
    </div>
  )
}

function EventCode(props: { code: string; onCommit: (code: string) => void }) {
  const [text, setText] = useState(props.code)
  useEffect(() => setText(props.code), [props.code])
  return (
    <textarea
      data-testid='hmi-event-code'
      className={`${FIELD_CLASS} h-20 resize-y py-1 font-mono`}
      value={text}
      placeholder='ST statements'
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== props.code && props.onCommit(text)}
    />
  )
}
