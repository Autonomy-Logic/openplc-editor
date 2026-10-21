// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2025 Autonomy®
/**
 * Click-to-place controller for one graphical editor instance.
 *
 * Owns the radial menu and the "armed" element that follows the cursor until
 * the user clicks a placement target, presses Escape or clicks elsewhere.
 * Elements are armed from the radial menu (right click on the programming
 * area) or with Cmd + digit on macOS and Alt + digit elsewhere, also while a
 * text field such as a new element's variable name has focus.
 *
 * Placement targets are DOM elements marked with `data-placement-target`
 * inside this provider. They read `armed` from the context, perform the
 * insertion on left click and then call `consume()`; any left click outside
 * a target cancels.
 */

import {
  createContext,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { i18n } from '../../../../../../locales/i18n'
import { useOpenPLCStore } from '../../../../../../store'
import {
  formatPlacementShortcut,
  getPlacementElementForShortcut,
  getPlacementElements,
  getShortcutModifier,
  isShortcutAllowedFromTarget,
  PLACEMENT_TARGET_ATTRIBUTE,
  type PlacementElementId,
  type PlacementLanguage,
} from '../../../../../../utils/graphical/placement-elements'
import type { Point } from '../../../../../../utils/graphical/radial-menu-geometry'
import { CursorFollower } from '../../../../../_atoms/cursor-follower'
import { RadialMenu, type RadialMenuItem } from '../../../../../_molecules/radial-menu'
import { renderPlacementIcon } from './placement-icons'

export type GraphicalPlacementContextValue = {
  language: PlacementLanguage
  /** Element following the cursor, or `null`. */
  armed: PlacementElementId | null
  /** Opens the radial menu for a right click on the programming area. */
  handleContextMenu: (event: ReactMouseEvent) => void
  /** Returns the armed element and clears it. */
  consume: () => PlacementElementId | null
  cancel: () => void
}

const GraphicalPlacementContext = createContext<GraphicalPlacementContextValue | null>(null)

/** Placement controller of the enclosing graphical editor, or `null` outside one. */
export function useGraphicalPlacement(): GraphicalPlacementContextValue | null {
  return useContext(GraphicalPlacementContext)
}

type ProviderProps = {
  language: PlacementLanguage
  isActive: boolean
  readOnly?: boolean
  children: ReactNode
}

const hasOpenDialog = (): boolean => document.querySelector('[role="dialog"][data-state="open"]') !== null

const placementLabel = (id: PlacementElementId): string => i18n.t(`editorTools:placement.elements.${id}`)

export function GraphicalPlacementProvider({ language, isActive, readOnly = false, children }: ProviderProps) {
  const isDebuggerVisible = useOpenPLCStore((state) => state.workspace.isDebuggerVisible)

  const elements = getPlacementElements(language)
  const modifier = getShortcutModifier(navigator.platform)
  const canEdit = isActive && !readOnly && !isDebuggerVisible && elements.length > 0

  const [menuPosition, setMenuPosition] = useState<Point | null>(null)
  const [armed, setArmed] = useState<{ id: PlacementElementId; origin: Point } | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const pointerRef = useRef<Point>({ x: 0, y: 0 })
  const armedRef = useRef<PlacementElementId | null>(null)
  armedRef.current = armed?.id ?? null

  const cancel = useCallback(() => {
    setMenuPosition(null)
    setArmed(null)
  }, [])

  const consume = useCallback(() => {
    const current = armedRef.current
    armedRef.current = null
    setArmed(null)
    return current
  }, [])

  const arm = useCallback((id: PlacementElementId) => {
    setMenuPosition(null)
    setArmed({ id, origin: { ...pointerRef.current } })
  }, [])

  useEffect(() => {
    if (!canEdit) cancel()
  }, [canEdit, cancel])

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      if (!canEdit) return
      event.preventDefault()
      event.stopPropagation()
      pointerRef.current = { x: event.clientX, y: event.clientY }
      setArmed(null)
      setMenuPosition({ x: event.clientX, y: event.clientY })
    },
    [canEdit],
  )

  useEffect(() => {
    if (!isActive) return
    const handlePointerMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY }
    }
    document.addEventListener('pointermove', handlePointerMove, true)
    return () => document.removeEventListener('pointermove', handlePointerMove, true)
  }, [isActive])

  useEffect(() => {
    if (!canEdit) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && armedRef.current) {
        event.preventDefault()
        event.stopPropagation()
        cancel()
        return
      }
      const element = getPlacementElementForShortcut(language, event, modifier)
      if (!element || !isShortcutAllowedFromTarget(event, modifier) || hasOpenDialog()) return
      event.preventDefault()
      event.stopPropagation()
      arm(element.id)
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [canEdit, language, modifier, arm, cancel])

  useEffect(() => {
    if (!armed) return
    const isOnTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element) || !containerRef.current) return false
      const placementTarget = target.closest(`[${PLACEMENT_TARGET_ATTRIBUTE}]`)
      return placementTarget !== null && containerRef.current.contains(placementTarget)
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || isOnTarget(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      cancel()
    }
    const handleContextMenu = (event: MouseEvent) => {
      if (event.target instanceof Node && containerRef.current?.contains(event.target)) return
      cancel()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('contextmenu', handleContextMenu, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('contextmenu', handleContextMenu, true)
    }
  }, [armed, cancel])

  const menuItems = useMemo<RadialMenuItem[]>(
    () =>
      elements.map((element) => ({
        id: element.id,
        label: placementLabel(element.id),
        hint: formatPlacementShortcut(element, modifier),
        icon: renderPlacementIcon(language, element.id),
      })),
    [elements, language, modifier],
  )

  const handleSelect = useCallback(
    (id: string) => {
      const element = elements.find((candidate) => candidate.id === id)
      if (element) arm(element.id)
      else cancel()
    },
    [elements, arm, cancel],
  )

  const value = useMemo<GraphicalPlacementContextValue>(
    () => ({ language, armed: armed?.id ?? null, handleContextMenu, consume, cancel }),
    [language, armed, handleContextMenu, consume, cancel],
  )

  return (
    <GraphicalPlacementContext.Provider value={value}>
      <div ref={containerRef} className='contents'>
        {children}
      </div>
      {menuPosition && (
        <RadialMenu
          items={menuItems}
          position={menuPosition}
          title={
            language === 'ld' ? i18n.t('editorTools:placement.title.ld') : i18n.t('editorTools:placement.title.fbd')
          }
          onSelect={handleSelect}
          onClose={cancel}
        />
      )}
      {armed && (
        <CursorFollower initialPosition={armed.origin} label={placementLabel(armed.id)}>
          {renderPlacementIcon(language, armed.id)}
        </CursorFollower>
      )}
    </GraphicalPlacementContext.Provider>
  )
}
