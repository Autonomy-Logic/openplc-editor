import * as monaco from 'monaco-editor'

import type { DiffHunk } from '../../../../../utils/ai-diff-review'

/** Render all diff review UI for the given hunks. Returns a cleanup function. */
export function renderDiffReview(
  editor: monaco.editor.IStandaloneCodeEditor,
  hunks: DiffHunk[],
  onKeep: (hunkId: string) => void,
  onUndo: (hunkId: string) => void,
): () => void {
  const viewZoneIds: string[] = []

  // Clean up any stale buttons from previous renders
  const editorDom = editor.getDomNode()
  if (editorDom) {
    editorDom.querySelectorAll('.ai-hunk-buttons').forEach((el) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(el as any)._scrollDisposable?.dispose()
      el.remove()
    })
  }

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

  // 3. Action buttons per hunk ("Keep" / "Undo")
  const buttonContainers: HTMLDivElement[] = []

  if (editorDom) {
    for (const hunk of hunks) {
      const container = document.createElement('div')
      container.className = 'ai-hunk-buttons'
      container.style.cssText = `
        position: absolute; right: 24px; z-index: 20; pointer-events: auto;
        display: inline-flex; flex-direction: row; gap: 4px;
      `

      const keepBtn = document.createElement('button')
      keepBtn.textContent = 'Keep'
      keepBtn.style.cssText = `
        cursor: pointer; border: none; background: rgba(34,197,94,0.2);
        color: #4ade80; border-radius: 3px; padding: 1px 8px;
        font-size: 10px; font-weight: 500; font-family: inherit;
        transition: background 0.15s; line-height: 16px;
      `
      keepBtn.onmouseenter = () => {
        keepBtn.style.background = 'rgba(34,197,94,0.35)'
      }
      keepBtn.onmouseleave = () => {
        keepBtn.style.background = 'rgba(34,197,94,0.2)'
      }
      keepBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        onKeep(hunk.id)
      })

      const undoBtn = document.createElement('button')
      undoBtn.textContent = 'Undo'
      undoBtn.style.cssText = `
        cursor: pointer; border: none; background: rgba(239,68,68,0.2);
        color: #f87171; border-radius: 3px; padding: 1px 8px;
        font-size: 10px; font-weight: 500; font-family: inherit;
        transition: background 0.15s; line-height: 16px;
      `
      undoBtn.onmouseenter = () => {
        undoBtn.style.background = 'rgba(239,68,68,0.35)'
      }
      undoBtn.onmouseleave = () => {
        undoBtn.style.background = 'rgba(239,68,68,0.2)'
      }
      undoBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        onUndo(hunk.id)
      })

      container.appendChild(keepBtn)
      container.appendChild(undoBtn)

      // Position based on the line's top coordinate
      const topPx = Math.max(0, editor.getTopForLineNumber(hunk.startLine) - editor.getScrollTop())
      container.style.top = `${topPx}px`

      editorDom.appendChild(container)
      buttonContainers.push(container)

      // Update position on scroll
      const scrollDisposable = editor.onDidScrollChange(() => {
        const newTop = Math.max(0, editor.getTopForLineNumber(hunk.startLine) - editor.getScrollTop())
        container.style.top = `${newTop}px`
      })

      // Store disposable for cleanup
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(container as any)._scrollDisposable = scrollDisposable
    }
  }

  // Cleanup function — removes everything
  return () => {
    decorations.clear()
    editor.changeViewZones((accessor) => {
      for (const id of viewZoneIds) {
        accessor.removeZone(id)
      }
    })
    for (const container of buttonContainers) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(container as any)._scrollDisposable?.dispose()
      container.remove()
    }
  }
}
