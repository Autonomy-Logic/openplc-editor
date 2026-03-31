import type * as monaco from 'monaco-editor'

import type { AICompleteParams, AIPort } from '../../../../../../../middleware/shared/ports/ai-port'
import { openPLCStoreBase } from '../../../../../../store'
import { buildFIMContext } from './context-builder'

// ---------------------------------------------------------------------------
// Inline utilities
// ---------------------------------------------------------------------------

class CompletionCache<V> {
  private readonly maxSize: number
  private readonly cache = new Map<string, V>()

  constructor(maxSize = 16) {
    this.maxSize = maxSize
  }

  get(key: string): V | undefined {
    const value = this.cache.get(key)
    if (value === undefined) return undefined
    this.cache.delete(key)
    this.cache.set(key, value)
    return value
  }

  set(key: string, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }
    this.cache.set(key, value)
  }

  clear(): void {
    this.cache.clear()
  }
}

function buildCacheKey(fileUri: string, offset: number, prefixHash: string): string {
  return `${fileUri}:${offset}:${prefixHash}`
}

function hashString(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

type TelemetryTimer = { elapsed: () => number }

function startTimer(): TelemetryTimer {
  const start = performance.now()
  return { elapsed: () => Math.round(performance.now() - start) }
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

type CachedCompletion = {
  item: monaco.languages.InlineCompletion
  triggerPrefix: string
}

type ShownCompletion = {
  text: string
  position: { lineNumber: number; column: number }
  model: monaco.editor.ITextModel
  shownAt: number
}

/**
 * Monaco InlineCompletionsProvider powered by the AI backend.
 * Streams inline completions via the AIPort with caching, debouncing, and request cancellation.
 */
export class AIInlineCompletionProvider implements monaco.languages.InlineCompletionsProvider {
  private activeAbortController: AbortController | null = null
  private readonly cache = new CompletionCache<CachedCompletion>(16)
  private lastResult: CachedCompletion | null = null
  private lastTriggerPrefix = ''
  private lastShown: ShownCompletion | null = null
  private static readonly DEBOUNCE_MS = 400
  private static readonly TIMEOUT_MS = 2000

  constructor(
    private readonly pouName: string,
    private readonly language: 'st' | 'il' | 'python' | 'cpp',
    private readonly aiPort: AIPort,
  ) {}

  async provideInlineCompletions(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    _context: monaco.languages.InlineCompletionContext,
    token: monaco.CancellationToken,
  ): Promise<monaco.languages.InlineCompletions> {
    const emptyResult = { items: [] }

    // Check if AI is enabled
    const aiState = openPLCStoreBase.getState().ai
    if (!aiState.isEnabled) return emptyResult

    const offset = model.getOffsetAt(position)
    const lineContent = model.getLineContent(position.lineNumber)
    const textBeforeCursor = lineContent.substring(0, position.column - 1)

    // Skip if cursor is at the start of a line with no content
    if (textBeforeCursor.trim().length === 0 && position.column <= 1) return emptyResult

    const prefixForHash = model.getValue().substring(Math.max(0, offset - 200), offset)
    const cacheKey = buildCacheKey(model.uri.toString(), offset, hashString(prefixForHash))

    // 1. Cache lookup (instant, no debounce needed)
    const cached = this.cache.get(cacheKey)
    if (cached) {
      this.trackShown(model, position, cached.item.insertText as string, 0, 'cache')
      return { items: [cached.item] }
    }

    // 2. Try recycling previous result (instant, no debounce needed)
    if (this.lastResult && this.canRecycle(textBeforeCursor)) {
      this.trackShown(model, position, this.lastResult.item.insertText as string, 0, 'recycled')
      return { items: [this.lastResult.item] }
    }

    // 3. Cancel in-flight request
    if (this.activeAbortController) {
      this.activeAbortController.abort()
    }

    // 4. Debounce
    if (token.isCancellationRequested) return emptyResult

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, AIInlineCompletionProvider.DEBOUNCE_MS)
      token.onCancellationRequested(() => {
        clearTimeout(timer)
        resolve()
      })
    })

    if (token.isCancellationRequested) return emptyResult
    this.activeAbortController = new AbortController()
    const { signal } = this.activeAbortController

    token.onCancellationRequested(() => {
      this.activeAbortController?.abort()
    })

    // 5. Build FIM context
    const fimContext = buildFIMContext(model, position, this.pouName, this.language)

    // 6. Stream completion
    const currentModel = openPLCStoreBase.getState().ai.model
    const timer = startTimer()

    try {
      const request: AICompleteParams = {
        prefix: fimContext.prefix,
        suffix: fimContext.suffix,
        language: fimContext.language,
        projectContext: fimContext.projectContext || undefined,
        model: currentModel,
        maxTokens: 256,
      }

      this.aiPort.sendTelemetry('completion_requested', {
        language: this.language,
        model: currentModel,
        prefixLength: request.prefix.length,
        suffixLength: request.suffix.length,
        hasProjectContext: !!request.projectContext,
      })

      // 6a. Start client-side timeout
      const timeoutId = setTimeout(() => {
        this.activeAbortController?.abort()
        this.aiPort.sendTelemetry('completion_timeout', {
          language: this.language,
          model: currentModel,
          timeoutMs: AIInlineCompletionProvider.TIMEOUT_MS,
        })
      }, AIInlineCompletionProvider.TIMEOUT_MS)

      let completion = ''
      let ttftMs = -1
      for await (const chunk of this.aiPort.streamCompletion(request, signal)) {
        if (ttftMs < 0) {
          ttftMs = timer.elapsed()
          clearTimeout(timeoutId)
        }
        completion += chunk
      }
      clearTimeout(timeoutId)

      // Strip markdown fences the model sometimes adds
      completion = AIInlineCompletionProvider.stripMarkdownFences(completion)

      // Empty completion
      if (!completion.trim()) return emptyResult

      // 7. Cache and return
      const item: monaco.languages.InlineCompletion = {
        insertText: completion,
        range: {
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        },
      }

      const entry: CachedCompletion = { item, triggerPrefix: textBeforeCursor }
      this.cache.set(cacheKey, entry)
      this.lastResult = entry
      this.lastTriggerPrefix = textBeforeCursor

      this.trackShown(model, position, completion, timer.elapsed(), 'network', ttftMs)

      return { items: [item] }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return emptyResult

      const statusCode = (error as { status?: number }).status
      this.aiPort.sendTelemetry('completion_error', {
        language: this.language,
        model: currentModel,
        errorType: statusCode ? 'api_error' : error instanceof Error ? error.name : 'unknown',
        ...(statusCode !== undefined && { statusCode }),
        latencyMs: timer.elapsed(),
      })
      console.warn('[AI Completion]', error instanceof Error ? error.message : error)
      return emptyResult
    }
  }

  freeInlineCompletions(_completions: monaco.languages.InlineCompletions): void {
    this.trackAcceptOrDismiss()
  }

  disposeInlineCompletions(_completions: monaco.languages.InlineCompletions): void {
    this.trackAcceptOrDismiss()
  }

  /** Cancel any active request (called on dispose) */
  dispose(): void {
    this.activeAbortController?.abort()
    this.activeAbortController = null
    this.cache.clear()
    this.lastResult = null
  }

  private trackShown(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    completionText: string,
    latencyMs: number,
    source: 'network' | 'cache' | 'recycled',
    ttftMs?: number,
  ): void {
    this.lastShown = {
      text: completionText,
      position: { lineNumber: position.lineNumber, column: position.column },
      model,
      shownAt: performance.now(),
    }
    this.aiPort.sendTelemetry('completion_shown', {
      language: this.language,
      model: openPLCStoreBase.getState().ai.model,
      completionLength: completionText.length,
      latencyMs,
      source,
      ...(ttftMs !== undefined && { ttftMs }),
    })
  }

  private trackAcceptOrDismiss(): void {
    if (!this.lastShown) return

    const { text, position, model, shownAt } = this.lastShown
    this.lastShown = null

    const shownDurationMs = Math.round(performance.now() - shownAt)

    try {
      const lineContent = model.getLineContent(position.lineNumber)
      const textAfterPosition = lineContent.substring(position.column - 1)
      const accepted = textAfterPosition.startsWith(text.split('\n')[0])

      if (accepted) {
        this.aiPort.sendTelemetry('completion_accepted', { language: this.language, completionLength: text.length })
      } else {
        this.aiPort.sendTelemetry('completion_dismissed', {
          language: this.language,
          completionLength: text.length,
          shownDurationMs,
        })
      }
    } catch {
      this.aiPort.sendTelemetry('completion_dismissed', {
        language: this.language,
        completionLength: text.length,
        shownDurationMs,
      })
    }
  }

  private canRecycle(currentPrefix: string): boolean {
    if (!this.lastResult || !this.lastTriggerPrefix) return false
    return currentPrefix.startsWith(this.lastTriggerPrefix) && currentPrefix !== this.lastTriggerPrefix
  }

  private static stripMarkdownFences(text: string): string {
    const fenceMatch = text.match(/^```[\w]*\n([\s\S]*?)\n?```\s*$/)
    if (fenceMatch) return fenceMatch[1]

    let result = text.replace(/^```[\w]*\n/, '')
    result = result.replace(/\n?```\s*$/, '')

    return result
  }
}
