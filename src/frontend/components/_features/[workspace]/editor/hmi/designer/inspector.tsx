/**
 * The selected element's name, data, display, layout and actions. Each property shows its value as written or the
 * widget's default, and an edit goes back as ST text; an empty field removes the property.
 */
import { ToggleSwitch } from '@root/frontend/components/_atoms/toggle-switch'
import type {
  HmiPlcVariable,
  HmiWidgetCatalog,
  HmiWidgetInfo,
  HmiWidgetProperty,
} from '@root/middleware/shared/ports/hmi-preview-types'
import { stString } from '@root/middleware/shared/utils/hmi/designer/designer-edits'
import {
  type DesignerElement,
  type DesignerModel,
  stringLiteralValue,
} from '@root/middleware/shared/utils/hmi/designer/designer-model'
import { useEffect, useState } from 'react'

import { DesignerSelect, Field, FIELD_CLASS, Section } from './parts'

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

export function Inspector(props: {
  model: DesignerModel
  element: DesignerElement | null
  catalog: HmiWidgetCatalog
  variables: readonly HmiPlcVariable[]
  screens: readonly string[]
  actions: InspectorActions
  locked: boolean
}) {
  const { element, catalog, actions } = props
  if (!element) {
    return (
      <div className='p-3 font-caption text-xs text-neutral-500' data-testid='hmi-inspector-empty'>
        Select an element on the canvas or in the outline.
      </div>
    )
  }
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
  if (element.locked) {
    return (
      <div
        className='p-3 font-caption text-xs text-neutral-600 dark:text-neutral-400'
        data-testid='hmi-inspector-locked'
      >
        {element.name} is edited in the code view: {element.locked}.
      </div>
    )
  }
  return (
    <fieldset disabled={props.locked} className='flex min-w-0 flex-col' data-testid='hmi-inspector'>
      <Section title={info?.name ?? element.type}>
        <Field label='Name'>
          <CommitField
            value={element.name}
            testId='hmi-element-name'
            onCommit={(name) => actions.rename(element.name, name.trim())}
          />
        </Field>
      </Section>
      {info?.main && (
        <Section title='Data' testId='hmi-data'>
          <Field
            label={`${info.main.name} (${info.main.type})`}
            hint={info.twoWay ? 'The operator can change it' : 'Shown on the widget'}
          >
            <DesignerSelect
              value={binding(info.main.name) ?? NONE}
              testId='hmi-main-binding'
              options={[
                { value: NONE, label: 'Not bound' },
                ...props.variables.map((v) => ({ value: v.path, label: `${v.path} : ${v.type}` })),
              ]}
              onChange={(v) => actions.bind(element.name, info.main?.name ?? '', v === NONE ? null : v)}
            />
          </Field>
          {binding(info.main.name) === undefined && mainProperty && row(mainProperty)}
        </Section>
      )}
      {editable('data').length > 0 && <Section title='Data properties'>{editable('data').map(row)}</Section>}
      {editable('display').length > 0 && <Section title='Display'>{editable('display').map(row)}</Section>}
      {editable('layout').length > 0 && <Section title='Layout'>{editable('layout').map(row)}</Section>}
      {(info?.events ?? []).map((event) => {
        const code = props.model.events.find((e) => same(e.element, element.name) && same(e.event, event))?.code ?? ''
        return (
          <Section key={event} title={`Action on ${event}`} testId={`hmi-event-${event}`}>
            <DesignerSelect
              value={NONE}
              options={[
                { value: NONE, label: 'Show a screen…' },
                ...props.screens.map((s) => ({ value: s, label: s })),
              ]}
              onChange={(s) => s !== NONE && actions.setEvent(element.name, event, `HMI_Show(HMI_SCREEN#${s});`)}
            />
            <EventCode
              code={code}
              onCommit={(text) => actions.setEvent(element.name, event, text.trim() === '' ? null : text)}
            />
          </Section>
        )
      })}
      <div className='p-3'>
        <button
          type='button'
          data-testid='hmi-delete-element'
          onClick={() => actions.remove(element.name)}
          className='h-7 w-full rounded-md bg-neutral-100 font-caption text-xs font-medium text-red-600 hover:bg-neutral-200 dark:bg-neutral-900 dark:hover:bg-neutral-850'
        >
          Delete {element.name}
        </button>
      </div>
    </fieldset>
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
