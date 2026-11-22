import {
  labelSourceSignature,
  type LadderLabelSource,
  layoutRung,
  pouLabelSource,
  type PouPresentation,
  presentPou,
  type RungLayout,
} from '@root/middleware/shared/utils/ladder-layout'
import { createContext, useContext, useMemo } from 'react'

import { useContentStable } from '../../../../../hooks/use-content-stable'
import { useOpenPLCStore } from '../../../../../store'
import type { RungLadderState } from '../../../../../store/slices/ladder'

/** What every rung of one LD POU canvas draws from: the POU's label source, each rung's layout and the presentation. */
export interface LadderPouCanvas {
  labelSource: LadderLabelSource
  layouts: ReadonlyMap<RungLadderState, RungLayout>
  presentation: PouPresentation
}

const LadderPouCanvasContext = createContext<LadderPouCanvas | null>(null)

/** Provides the POU canvas to the rungs below it. */
export const LadderPouCanvasProvider = LadderPouCanvasContext.Provider

/** The enclosing POU canvas, or null when a rung is drawn outside one. */
export function useLadderPouCanvas(): LadderPouCanvas | null {
  return useContext(LadderPouCanvasContext)
}

/** True when two label sources draw the same location texts. */
const sameLabelSource = (previous: LadderLabelSource, next: LadderLabelSource): boolean =>
  labelSourceSignature(previous) === labelSourceSignature(next)

/**
 * The label source of POU `pouName`, kept as the same object while it draws the same location texts; `provided` is
 * used instead of reading the project when given.
 */
export function useLadderLabelSource(pouName: string, provided?: LadderLabelSource): LadderLabelSource {
  const projectData = useOpenPLCStore((state) => state.project.data)
  return useContentStable(
    useMemo(() => provided ?? pouLabelSource(projectData, pouName), [provided, projectData, pouName]),
    sameLabelSource,
  )
}

/** The canvas of POU `pouName`: its rungs laid out once and presented in an editor `viewportWidthPx` wide. */
export function useLadderPouCanvasValue(
  pouName: string,
  rungs: readonly RungLadderState[],
  viewportWidthPx: number,
): LadderPouCanvas {
  const labelSource = useLadderLabelSource(pouName)
  const layouts = useMemo(
    () => new Map(rungs.map((rung) => [rung, layoutRung(rung, labelSource)] as const)),
    [rungs, labelSource],
  )
  const presentation = useMemo(() => presentPou([...layouts.values()], viewportWidthPx), [layouts, viewportWidthPx])
  return useMemo(() => ({ labelSource, layouts, presentation }), [labelSource, layouts, presentation])
}
