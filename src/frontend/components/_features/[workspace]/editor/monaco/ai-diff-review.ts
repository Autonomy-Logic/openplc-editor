import * as monaco from 'monaco-editor'

import type { DiffHunk } from '../../../../../utils/ai-diff-review'

// Brand colors (must match src/backend/shared/styles/globals.css :root vars)
const BRAND_DEFAULT = '#0464fb'
const BRAND_MEDIUM_DARK = '#023c97'
// Subtle 10%-alpha tint of the brand color — used for the outlined Reject button's hover.
// The solid BRAND_LIGHT (#b4d0fe) was too loud against the blue text/border.
const REJECT_HOVER_BG = 'rgba(4, 100, 251, 0.1)'

/** Render all diff review UI for the given hunks. Returns a cleanup function. */
export function renderDiffReview(
  editor: monaco.editor.IStandaloneCodeEditor,
  hunks: DiffHunk[],
  onAccept: (hunkId: string) => void,
  onReject: (hunkId: string) => void,
): () => void {
  const viewZoneIds: string[] = []

  // 1. Line decorations (green backgrounds for added/modified lines)
  const decoOptions: monaco.editor.IModelDeltaDecoration[] = []
  for (const hunk of hunks) {
    if (hunk.type === 'added' || hunk.type === 'modified') {
      for (let line = hunk.startLine; line <= hunk.endLine; line++) {
        decoOptions.push({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: true,
            className: 'ai-diff-added',
            glyphMarginClassName: 'ai-diff-added-gutter',
          },
        })
      }
    }
  }
  const decorations = editor.createDecorationsCollection(decoOptions)

  // 2. View zones for deleted/modified lines (red ghost text)
  editor.changeViewZones((accessor) => {
    for (const hunk of hunks) {
      if (hunk.oldLines.length === 0) continue
      if (hunk.type !== 'removed' && hunk.type !== 'modified') continue

      const domNode = document.createElement('div')
      domNode.className = 'ai-diff-removed-zone'
      domNode.style.fontFamily = 'var(--vscode-editor-font-family, monospace)'
      domNode.style.fontSize = '13px'
      domNode.style.lineHeight = '19px'
      domNode.style.paddingLeft = '60px'
      domNode.style.opacity = '0.45'

      for (const line of hunk.oldLines) {
        const lineDiv = document.createElement('div')
        lineDiv.textContent = line || ' '
        lineDiv.style.textDecoration = 'line-through'
        lineDiv.style.color = 'rgba(239, 68, 68, 0.7)'
        domNode.appendChild(lineDiv)
      }

      const zoneId = accessor.addZone({
        afterLineNumber: hunk.startLine - 1,
        heightInLines: hunk.oldLines.length,
        domNode,
      })
      viewZoneIds.push(zoneId)
    }
  })

  // 3. Action buttons per hunk ("Accept" / "Reject") — rendered as a right-aligned DOM
  //    overlay anchored to each hunk's start line. Monaco content widgets can't be
  //    anchored to the viewport edge (they track a code column), so we use a manual
  //    overlay with an onDidScrollChange handler to keep buttons in sync with scroll.
  //    Adjacent hunks get a vertical offset if their natural positions would collide.
  const buttonContainers: HTMLDivElement[] = []
  const scrollDisposables: monaco.IDisposable[] = []
  const editorDom = editor.getDomNode()

  const BUTTON_HEIGHT = 18 // approx height of one row of buttons (10px font + 2×padding + border)
  const MIN_GAP = 4

  // Clean up any stale button containers from previous renders (defensive — the cleanup
  // closure below should handle this, but guard in case the caller forgets to invoke it).
  if (editorDom) {
    editorDom.querySelectorAll('.ai-hunk-buttons').forEach((el) => el.remove())
  }

  if (editorDom) {
    // Sort by startLine so collision offsetting reads prior bottom positions correctly.
    const sortedHunks = [...hunks].sort((a, b) => a.startLine - b.startLine)

    for (const hunk of sortedHunks) {
      const container = document.createElement('div')
      container.className = 'ai-hunk-buttons'
      container.style.cssText = `
        position: absolute; right: 24px; z-index: 20; pointer-events: auto;
        display: inline-flex; flex-direction: row; gap: 4px;
      `

      const acceptBtn = document.createElement('button')
      acceptBtn.textContent = 'Accept'
      acceptBtn.style.cssText = `
        cursor: pointer; border: none; background: ${BRAND_DEFAULT};
        color: #ffffff; border-radius: 3px; padding: 1px 8px;
        font-size: 10px; font-weight: 500; font-family: inherit;
        transition: background 0.15s; line-height: 16px;
      `
      acceptBtn.onmouseenter = () => {
        acceptBtn.style.background = BRAND_MEDIUM_DARK
      }
      acceptBtn.onmouseleave = () => {
        acceptBtn.style.background = BRAND_DEFAULT
      }
      acceptBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        onAccept(hunk.id)
      })

      const rejectBtn = document.createElement('button')
      rejectBtn.textContent = 'Reject'
      rejectBtn.style.cssText = `
        cursor: pointer; background: transparent; color: ${BRAND_DEFAULT};
        border: 1px solid ${BRAND_DEFAULT}; border-radius: 3px; padding: 0 7px;
        font-size: 10px; font-weight: 500; font-family: inherit;
        transition: background 0.15s; line-height: 16px;
      `
      rejectBtn.onmouseenter = () => {
        rejectBtn.style.background = REJECT_HOVER_BG
      }
      rejectBtn.onmouseleave = () => {
        rejectBtn.style.background = 'transparent'
      }
      rejectBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        onReject(hunk.id)
      })

      container.appendChild(acceptBtn)
      container.appendChild(rejectBtn)

      editorDom.appendChild(container)
      buttonContainers.push(container)
    }

    const layoutButtons = () => {
      const scrollTop = editor.getScrollTop()
      const editorHeight = editor.getLayoutInfo().height
      let lastBottom = -Infinity
      sortedHunks.forEach((hunk, idx) => {
        const container = buttonContainers[idx]
        const natural = editor.getTopForLineNumber(hunk.startLine) - scrollTop

        // Hide buttons whose anchor line is outside the visible editor area — otherwise
        // hunks that scroll off the top would clamp to top:0 and pile up at the viewport edge.
        if (natural < 0 || natural > editorHeight - BUTTON_HEIGHT) {
          container.style.display = 'none'
          return
        }

        container.style.display = 'inline-flex'
        const top = Math.max(natural, lastBottom + MIN_GAP)
        container.style.top = `${top}px`
        lastBottom = top + BUTTON_HEIGHT
      })
    }

    layoutButtons()
    scrollDisposables.push(editor.onDidScrollChange(() => layoutButtons()))
  }

  // Cleanup function — removes everything
  return () => {
    decorations.clear()
    editor.changeViewZones((accessor) => {
      for (const id of viewZoneIds) {
        accessor.removeZone(id)
      }
    })
    for (const d of scrollDisposables) d.dispose()
    for (const container of buttonContainers) container.remove()
  }
}
