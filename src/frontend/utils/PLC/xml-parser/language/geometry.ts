import { Position } from '@xyflow/react'

import { asRecord, asString } from '../xml-node'

export type XyPosition = { x: number; y: number }

// Shared by every graphical-body parser (fbd-xml.ts, ladder-xml.ts): position/
// dimension attributes are always numeric strings (parseAttributeValue is off
// project-wide, see parse-xml-document.ts), so every numeric read goes
// through this.
export function toNumber(value: unknown, fallback = 0): number {
  const n = Number(asString(value))
  return Number.isFinite(n) ? n : fallback
}

export function parsePositionXml(xml: unknown): XyPosition {
  const rec = asRecord(xml)
  return { x: toNumber(rec['@x']), y: toNumber(rec['@y']) }
}

// Structural shape of `CustomHandleProps` (fbd/handle.tsx, ladder/handle.tsx)
// minus the framework-optional fields — kept local instead of importing
// either component's type so this helper stays usable from both languages.
// `Position` is a real TS enum (not a string-literal union), so callers pass
// `Position.Left`/`Position.Right`, not plain strings.
export interface HandleGeometry {
  id: string
  type: 'source' | 'target'
  position: Position
  glbPosition: XyPosition
  relPosition: XyPosition
  /**
   * CSS offset for the handle's DOM element. React Flow draws edges to where
   * the handle actually renders, so an element whose connectors sit somewhere
   * other than its vertical centre must supply this — `relPosition` alone only
   * describes the model, not the layout.
   */
  style?: { top: number; left?: number; right?: number }
}

// glbPosition (absolute canvas coordinates) never appears in PLCopen XML —
// only relPosition (offset from the node's own position) does. Reconstructed
// as node.position + relPosition; not necessarily byte-identical to what the
// original editor computed, but internally consistent for a fresh import.
export function makeHandle(
  id: string,
  kind: 'source' | 'target',
  side: Position,
  nodePosition: XyPosition,
  relPositionXml: unknown,
  style?: HandleGeometry['style'],
): HandleGeometry {
  const relPosition = parsePositionXml(relPositionXml)
  return {
    id,
    type: kind,
    position: side,
    relPosition,
    glbPosition: { x: nodePosition.x + relPosition.x, y: nodePosition.y + relPosition.y },
    ...(style ? { style } : {}),
  }
}
