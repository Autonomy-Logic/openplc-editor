import * as Popover from '@radix-ui/react-popover'
import {
  type LabelBox,
  LADDER_STYLE,
  LADDER_TYPOGRAPHY,
  type LadderSymbolKind,
  symbolKindOf,
} from '@root/middleware/shared/utils/ladder-layout'
import type { Node, NodeProps } from '@xyflow/react'
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react'

import { useDebugger } from '../../../../../middleware/shared/providers'
import { useDebugCompositeKey } from '../../../../hooks/use-debug-composite-key'
import { useDebugValue, useIsDebuggerVisible } from '../../../../hooks/use-debug-value'
import { forceDebugVariable, releaseDebugVariable } from '../../../../services/debug-force-variable'
import { isExpressionValidForType } from '../../../../services/graphical-scope'
import { useOpenPLCStore, useOpenPLCStoreApi } from '../../../../store'
import { cn } from '../../../../utils/cn'
import { edgeTriggerInstanceName, edgeTriggerTypeForVariant } from '../../../../utils/PLC/edge-trigger-instance'
import { useBoundPou } from '../../../_features/[workspace]/editor/graphical/active-context'
import { VariablesBlockAutoComplete } from './autocomplete'
import { CustomHandle, ladderHandleStyle } from './handle'
import { LadderSymbolGlyph, ladderSymbolInset } from './ladder-symbol'
import { LadderLocationText, LadderNameField, LadderText } from './ladder-text'
import { labelOfRole, LADDER_ERROR_COLOUR, LADDER_FORCED_COLOURS, useLadderNodeView } from './rung-view'
import { getLadderPouVariablesRungNodeAndEdges } from './utils'
import type { BasicNodeData } from './utils/types'

export type LadderCellKind = 'contact' | 'coil'

/** Node props of a contact or a coil. */
export type LadderCellProps = NodeProps<Node<BasicNodeData & { variant: string }>>

/** How a contact or coil symbol is drawn in a debug session, or `idle` outside one. */
type CellDebugState = 'idle' | 'on' | 'off' | 'forcedHigh' | 'forcedLow'

/** The name label of a cell, or where it goes when the layout has none. */
function nameLabelOf(labels: readonly LabelBox[], text: string): LabelBox {
  return (
    labelOfRole(labels, 'name') ?? {
      text,
      x: LADDER_STYLE.sym / 2,
      y: -LADDER_STYLE.labGap - LADDER_TYPOGRAPHY.locationSizePx * 1.3,
      sizePx: LADDER_TYPOGRAPHY.nameSizePx,
      weight: 400,
      anchor: 'middle',
      role: 'name',
    }
  )
}

/** Props of the drawing of a contact or coil, shared by the editor and the diff view. */
export interface LadderCellVisualProps {
  nodeId: string
  kind: LadderSymbolKind
  variableName: string
  symbolColour: string
  nameColour?: string
  energized?: boolean
  selected?: boolean
  interactive?: boolean
  nameSlot?: (label: LabelBox) => ReactNode
  onClick?: (event: MouseEvent<HTMLDivElement>) => void
}

/** Space between a selected contact or coil's highlight and its symbol, in px. */
const HIGHLIGHT_PAD = 3

/** A contact or coil: its symbol, its one-line name and its location line, from the rung layout. */
export function LadderCellVisual({
  nodeId,
  kind,
  variableName,
  symbolColour,
  nameColour,
  energized = false,
  selected = false,
  interactive = false,
  nameSlot,
  onClick,
}: LadderCellVisualProps) {
  const { labels, palette, labelSource } = useLadderNodeView(nodeId)
  const nameLabel = nameLabelOf(labels, variableName)
  const locationLabel = labelOfRole(labels, 'location')

  return (
    <div className='relative' style={{ width: LADDER_STYLE.sym, height: LADDER_STYLE.symH }} onClick={onClick}>
      {interactive && (
        <div
          className='peer absolute'
          style={{ left: 0, top: 0, width: LADDER_STYLE.sym, height: LADDER_STYLE.symH }}
        />
      )}
      <div
        aria-hidden
        data-selected={selected}
        className={cn('pointer-events-none absolute rounded-[3px]', {
          'bg-brand-light dark:bg-brand-medium-dark': selected,
          'peer-hover:bg-neutral-100 dark:peer-hover:bg-neutral-850': interactive && !selected,
        })}
        style={{
          left: -HIGHLIGHT_PAD,
          top: -HIGHLIGHT_PAD,
          width: LADDER_STYLE.sym + 2 * HIGHLIGHT_PAD,
          height: LADDER_STYLE.symH + 2 * HIGHLIGHT_PAD,
        }}
      />
      <div className='relative'>
        <LadderSymbolGlyph kind={kind} stroke={symbolColour} energized={energized} />
      </div>
      {nameSlot ? (
        nameSlot(nameLabel)
      ) : (
        <LadderText
          label={nameLabel}
          text={variableName}
          fill={nameColour ?? palette.text}
          testId={`ld-name-${nodeId}`}
        />
      )}
      {locationLabel && (
        <LadderLocationText
          label={locationLabel}
          variableName={variableName}
          labelSource={labelSource}
          fill={palette.loc}
          testId={`ld-location-${nodeId}`}
        />
      )}
    </div>
  )
}

/** A contact or coil of the LD editor: drawing, name editing with autocomplete, validation and debug forcing. */
export const LadderCellElement = ({ kind, ...block }: LadderCellProps & { kind: LadderCellKind }) => {
  const store = useOpenPLCStoreApi()
  const { selected, data, id } = block
  const pouName = useBoundPou()
  const pous = useOpenPLCStore((state) => state.project.data.pous)
  const updateNode = useOpenPLCStore((state) => state.ladderFlowActions.updateNode)
  const { palette } = useLadderNodeView(id)

  const debugger_ = useDebugger()
  const isDebuggerVisible = useIsDebuggerVisible()
  const getCompositeKey = useDebugCompositeKey()
  const compositeKey = getCompositeKey(data.variable.name)
  const { value: debugValue, isForced, forcedValue, debugIndex } = useDebugValue(compositeKey)
  const edgeTriggerType = kind === 'contact' ? edgeTriggerTypeForVariant(data.variant) : null
  const edgeTriggerName = edgeTriggerType ? edgeTriggerInstanceName(edgeTriggerType, data.numericId) : null
  const { value: edgeOutputValue } = useDebugValue(edgeTriggerName ? getCompositeKey(`${edgeTriggerName}.Q`) : '')

  const [wrongVariable, setWrongVariable] = useState<boolean>(false)
  const [editing, setEditing] = useState<boolean>(() => (selected ?? false) && !isDebuggerVisible)
  const [nameValue, setNameValue] = useState<string>(data.variable.name)
  const [openAutocomplete, setOpenAutocomplete] = useState<boolean>(false)
  const [keyPressed, setKeyPressed] = useState<string>('')
  const [isContextMenuOpen, setIsContextMenuOpen] = useState<boolean>(false)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const autocompleteRef = useRef<HTMLDivElement & { triggerSubmit?: () => void }>(null)

  useEffect(() => {
    const name = data.variable?.name?.trim() ?? ''
    let cancelled = false
    void isExpressionValidForType(pouName, name, 'BOOL').then((valid) => {
      if (!cancelled) setWrongVariable(!valid)
    })
    return () => {
      cancelled = true
    }
  }, [pous, pouName, data.variable.name])

  useEffect(() => {
    if (isDebuggerVisible) setEditing(false)
  }, [isDebuggerVisible])

  useEffect(() => {
    if (data.variable.name !== '') setNameValue(data.variable.name)
  }, [data.variable.name])

  const debugState = ((): CellDebugState => {
    if (!isDebuggerVisible || !data.variable.name || wrongVariable || debugValue === undefined) return 'idle'
    if (isForced) return forcedValue ? 'forcedHigh' : 'forcedLow'
    const shownValue = edgeTriggerType ? edgeOutputValue : debugValue
    if (shownValue === undefined) return 'idle'
    const isTrue = shownValue === '1' || shownValue.toUpperCase() === 'TRUE'
    const displayState = data.variant === 'negated' ? !isTrue : isTrue
    return displayState ? 'on' : 'off'
  })()

  const symbolColour = (() => {
    if (wrongVariable) return LADDER_ERROR_COLOUR
    switch (debugState) {
      case 'on':
        return palette.on
      case 'forcedHigh':
        return LADDER_FORCED_COLOURS.high
      case 'forcedLow':
        return LADDER_FORCED_COLOURS.low
      case 'off':
      case 'idle':
        return palette.text
      default: {
        const unreachable: never = debugState
        return unreachable
      }
    }
  })()

  const withNode = (apply: (found: NonNullable<ReturnType<typeof getLadderPouVariablesRungNodeAndEdges>>) => void) => {
    const { project, ladderFlows } = store.getState()
    apply(getLadderPouVariablesRungNodeAndEdges(pouName, project.data.pous, ladderFlows, { nodeId: id }))
  }

  const setDraggable = (draggable: (nodeData: Record<string, unknown>) => boolean) =>
    withNode(({ node, rung }) => {
      if (!node || !rung) return
      updateNode({
        editorName: pouName,
        nodeId: node.id,
        rungId: rung.id,
        node: { ...node, draggable: draggable(node.data) },
        transient: true,
      })
    })

  const commitName = (variableName: string) =>
    withNode(({ node, rung }) => {
      if (!rung || !node) return
      const current = node.data.variable
      const currentName =
        typeof current === 'object' && current !== null && 'name' in current && typeof current.name === 'string'
          ? current.name
          : undefined
      if (variableName === currentName) return
      updateNode({
        editorName: pouName,
        rungId: rung.id,
        nodeId: node.id,
        node: { ...node, data: { ...node.data, variable: { name: variableName } } },
      })
    })

  const forceTo = async (event: MouseEvent, high: boolean) => {
    event.preventDefault()
    event.stopPropagation()
    setIsContextMenuOpen(false)
    if (data.variable.name)
      await forceDebugVariable(store, debugger_, compositeKey, debugIndex, new Uint8Array([high ? 1 : 0]), high)
  }

  const releaseForce = async (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsContextMenuOpen(false)
    if (data.variable.name) await releaseDebugVariable(store, debugger_, compositeKey, debugIndex)
  }

  const openForceMenu = (event: MouseEvent) => {
    if (!isDebuggerVisible) return
    event.preventDefault()
    event.stopPropagation()
    setContextMenuPosition({ x: event.clientX, y: event.clientY })
    setIsContextMenuOpen(true)
  }

  const symbolKind = symbolKindOf(kind, data.variant) ?? kind

  return (
    <div className={cn({ 'opacity-40': id.startsWith('copycat') })}>
      <LadderCellVisual
        nodeId={id}
        kind={symbolKind}
        variableName={data.variable.name}
        symbolColour={symbolColour}
        energized={debugState === 'on'}
        selected={selected ?? false}
        interactive
        onClick={isDebuggerVisible ? openForceMenu : undefined}
        nameSlot={(label) => (
          <LadderNameField
            label={label}
            text={data.variable.name}
            testId={`ld-name-${id}`}
            palette={palette}
            fill={wrongVariable ? LADDER_ERROR_COLOUR : palette.text}
            editable={!isDebuggerVisible}
            editing={editing}
            onEditingChange={setEditing}
            value={nameValue}
            onValueChange={(value) => {
              setNameValue(value)
              if (editing && !openAutocomplete) setOpenAutocomplete(true)
            }}
            onCommit={commitName}
            onFocus={() => setDraggable(() => false)}
            onBlur={() => setDraggable((nodeData) => nodeData.draggable === true)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Tab') event.preventDefault()
              if (event.key === 'Enter' && openAutocomplete) {
                event.preventDefault()
                autocompleteRef.current?.triggerSubmit?.()
                return true
              }
              setKeyPressed(event.key)
              return false
            }}
            onKeyUp={() => setKeyPressed('')}
          >
            {openAutocomplete ? (
              <VariablesBlockAutoComplete
                ref={autocompleteRef}
                block={block}
                blockType={kind}
                valueToSearch={nameValue}
                isOpen={openAutocomplete}
                setIsOpen={setOpenAutocomplete}
                keyPressed={keyPressed}
              />
            ) : undefined}
          </LadderNameField>
        )}
      />

      {isDebuggerVisible && contextMenuPosition && (
        <Popover.Root open={isContextMenuOpen} onOpenChange={setIsContextMenuOpen}>
          <Popover.Portal>
            <Popover.Content
              align='start'
              side='bottom'
              sideOffset={5}
              className={cn(
                'box z-[100] flex h-fit w-fit min-w-32 flex-col rounded-lg text-xs',
                'focus:outline-none focus-visible:outline-none',
                'bg-white text-neutral-1000 dark:bg-neutral-950 dark:text-neutral-300',
              )}
              style={{ position: 'fixed', left: `${contextMenuPosition.x}px`, top: `${contextMenuPosition.y}px` }}
              onOpenAutoFocus={(event) => event.preventDefault()}
            >
              <div
                className='flex w-full cursor-pointer items-center gap-2 rounded-t-lg px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                onClick={(event) => void forceTo(event, true)}
              >
                <p>Force True</p>
              </div>
              <div
                className='flex w-full cursor-pointer items-center gap-2 px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                onClick={(event) => void forceTo(event, false)}
              >
                <p>Force False</p>
              </div>
              {isForced && (
                <div
                  className='flex w-full cursor-pointer items-center gap-2 rounded-b-lg px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                  onClick={(event) => void releaseForce(event)}
                >
                  <p>Release Force</p>
                </div>
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
      {data.handles.map((handle, index) => (
        <CustomHandle key={index} {...handle} style={ladderHandleStyle(handle, handleInset(handle, symbolKind))} />
      ))}
    </div>
  )
}

/** The display shift that puts a contact or coil handle where the wire meets its symbol. */
function handleInset(handle: BasicNodeData['handles'][number], kind: LadderSymbolKind): number {
  const inset = ladderSymbolInset(kind)
  return handle.type === 'target' ? inset : -inset
}
