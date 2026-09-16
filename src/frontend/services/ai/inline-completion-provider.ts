import type * as monaco from 'monaco-editor'

import type { AICompleteParams, AICompletionLanguage, AIPort } from '../../../middleware/shared/ports/ai-port'
import type { EdgeSessionState } from '../../../middleware/shared/ports/edge-account-port'
import type { BillingErrorPayload } from '../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../store'
import { buildFIMContext } from './context-builder'
import { isImeComposing } from './ime-state'

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
    /* v8 ignore next 3 -- provider always checks get() before set(), so has() is false */
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      /* v8 ignore next 3 -- Map with size >= maxSize always has a first key */
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

/** Resolve after `ms`, or early with `false` if the Monaco cancellation token fires first. */
function abortableDelay(ms: number, token: monaco.CancellationToken): Promise<boolean> {
  return new Promise((resolve) => {
    if (token.isCancellationRequested) {
      resolve(false)
      return
    }
    const id = setTimeout(() => resolve(true), ms)
    token.onCancellationRequested(() => {
      clearTimeout(id)
      resolve(false)
    })
  })
}

const CLOSING_CHARS = new Set([')', ']', '}', '"', "'", '`'])

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t'
}

/** Characters of `suggestion` consumed by `typed` (whitespace-tolerant), or `null` on divergence. */
function tolerantPrefixMatch(suggestion: string, typed: string): number | null {
  let i = 0
  let j = 0
  while (j < typed.length) {
    if (i >= suggestion.length) return null
    const sc = suggestion[i]
    const tc = typed[j]
    if (sc === tc) {
      i++
      j++
      continue
    }
    if (isWhitespace(sc) && isWhitespace(tc)) {
      while (i < suggestion.length && isWhitespace(suggestion[i])) i++
      while (j < typed.length && isWhitespace(typed[j])) j++
      continue
    }
    return null
  }
  return i
}

// Closers Monaco already auto-inserted after the cursor must not be duplicated by the ghost text.
function reconcileAutoClosed(remainder: string, lineSuffix: string): string {
  let trim = 0
  while (
    trim < remainder.length &&
    trim < lineSuffix.length &&
    isClosingChar(remainder[remainder.length - 1 - trim]) &&
    remainder[remainder.length - 1 - trim] === lineSuffix[trim]
  ) {
    trim++
  }
  return trim > 0 ? remainder.slice(0, remainder.length - trim) : remainder
}

function isClosingChar(ch: string): boolean {
  return CLOSING_CHARS.has(ch)
}

type CachedCompletion = {
  item: monaco.languages.InlineCompletion
}

type ActiveSuggestion = {
  text: string
  /** Where the ghost text begins (= the cursor when the suggestion was produced). */
  anchorLineNumber: number
  anchorColumn: number
}

type ShownCompletion = {
  text: string
  position: { lineNumber: number; column: number }
  model: monaco.editor.ITextModel
  shownAt: number
}

/** `none` also covers the cursor leaving the suggestion's line; `match` carries the shrunk ghost text. */
type TypeThroughResult =
  | { kind: 'none' }
  | { kind: 'match'; item: monaco.languages.InlineCompletion; matchedChars: number; completionLength: number }
  | { kind: 'consumed' }
  | { kind: 'diverged' }

export class AIInlineCompletionProvider implements monaco.languages.InlineCompletionsProvider {
  private activeAbortController: AbortController | null = null
  private readonly cache = new CompletionCache<CachedCompletion>(16)
  private lastResult: ActiveSuggestion | null = null
  private typeThroughTracked = false
  private lastShown: ShownCompletion | null = null
  private static readonly TIMEOUT_MS = 5000
  // Every network path is debounced so only the latest provide() call fetches and is logged as shown.
  private static readonly REQUEST_DEBOUNCE_MS = 300
  /** Minimum visible time (ms) for a completion to count as an impression. */
  private static readonly MIN_SHOWN_MS = 300

  // No requests while the account is known signed-out; widening backoff, released on session restore.
  private static readonly SIGNED_OUT_HOLD_MS = 30_000
  private static readonly SIGNED_OUT_HOLD_MAX_MS = 15 * 60_000
  private signedOutUntil = 0
  private signedOutHoldMs = AIInlineCompletionProvider.SIGNED_OUT_HOLD_MS

  private unsubscribeFromStore: (() => void) | null = null
  private unsubscribeFromPreferences: (() => void) | null = null
  private unsubscribeFromSession: (() => void) | null = null

  constructor(
    private readonly pouName: string,
    private readonly language: AICompletionLanguage,
    private readonly aiPort: AIPort,
    private readonly session?: EdgeSessionState,
  ) {
    // A sign-in ends the hold at once rather than at the end of the backoff.
    this.unsubscribeFromSession =
      session?.onRestored(() => {
        this.releaseSignedOutHold()
      }) ?? null
    // Variable, data type or POU changes make cached completions stale.
    this.unsubscribeFromStore = openPLCStoreBase.subscribe(
      (state) => {
        const pou = state.project.data.pous.find((p) => p.name === pouName)
        return [
          pou?.interface?.variables,
          state.project.data.dataTypes,
          state.project.data.configurations.resource.globalVariables,
          state.project.data.pous.length,
        ] as const
      },
      () => {
        this.cache.clear()
        this.clearActiveSuggestion()
      },
      {
        equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3],
      },
    )

    this.unsubscribeFromPreferences = openPLCStoreBase.subscribe(
      (state) => state.ai.preferences.inlineCompletionsEnabled,
      (enabled) => {
        if (!enabled) {
          this.activeAbortController?.abort()
          this.cache.clear()
          this.clearActiveSuggestion()
        }
      },
    )
  }

  async provideInlineCompletions(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    _context: monaco.languages.InlineCompletionContext,
    token: monaco.CancellationToken,
  ): Promise<monaco.languages.InlineCompletions> {
    const emptyResult = { items: [] }

    const aiState = openPLCStoreBase.getState().ai
    if (!aiState.isEnabled) return emptyResult
    if (!aiState.preferences.inlineCompletionsEnabled) return emptyResult

    // IME composition characters must not read as type-through divergence.
    if (isImeComposing()) return emptyResult

    if (this.isHeldForSignIn()) return emptyResult

    const offset = model.getOffsetAt(position)
    const lineContent = model.getLineContent(position.lineNumber)
    const textBeforeCursor = lineContent.substring(0, position.column - 1)

    if (offset === 0 && textBeforeCursor.trim().length === 0) return emptyResult

    const prefixForHash = model.getValue().substring(Math.max(0, offset - 200), offset)
    const cacheKey = buildCacheKey(model.uri.toString(), offset, hashString(prefixForHash))

    const typeThrough = this.tryTypeThrough(model, position)
    if (typeThrough.kind === 'match') {
      if (!this.typeThroughTracked) {
        this.typeThroughTracked = true
        this.aiPort.sendTelemetry('completion_shown', {
          language: this.language,
          model: 'haiku',
          completionLength: typeThrough.completionLength,
          source: 'type_through',
          matchedChars: typeThrough.matchedChars,
        })
      }
      return { items: [typeThrough.item] }
    }
    if (typeThrough.kind === 'consumed') {
      this.clearActiveSuggestion()
      return emptyResult
    }

    const cached = this.cache.get(cacheKey)
    if (cached) {
      this.trackShown(model, position, cached.item.insertText as string, 0, 'cache')
      return { items: [cached.item] }
    }

    const elapsed = await abortableDelay(AIInlineCompletionProvider.REQUEST_DEBOUNCE_MS, token)
    if (!elapsed || token.isCancellationRequested) return emptyResult

    if (this.activeAbortController) {
      this.activeAbortController.abort()
    }

    if (token.isCancellationRequested) return emptyResult

    // Kept in a local: a later call reassigns the nullable field.
    const controller = new AbortController()
    this.activeAbortController = controller
    const { signal } = controller

    token.onCancellationRequested(() => {
      this.activeAbortController?.abort()
    })

    const fimContext = buildFIMContext(model, position, this.pouName, this.language)

    const timer = startTimer()
    let _timedOut = false

    let timeoutId: ReturnType<typeof setTimeout> | undefined

    try {
      const request: AICompleteParams = {
        prefix: fimContext.prefix,
        suffix: fimContext.suffix,
        language: fimContext.language,
        projectContext: fimContext.projectContext || undefined,
        model: 'haiku',
        maxTokens: AIInlineCompletionProvider.estimateMaxTokens(textBeforeCursor, position, model),
      }

      // Capture the controller so a stale timeout can't abort a newer request.
      const localAbortController = this.activeAbortController
      timeoutId = setTimeout(() => {
        _timedOut = true
        localAbortController?.abort()
        // Not gated on `import.meta.env.DEV`: that is Vite-only and this module is shared.
        console.debug(
          `[AI Completion] TIMEOUT after ${AIInlineCompletionProvider.TIMEOUT_MS}ms (no first token received) | model=haiku`,
        )
        this.aiPort.sendTelemetry('completion_timeout', {
          language: this.language,
          model: 'haiku',
          timeoutMs: AIInlineCompletionProvider.TIMEOUT_MS,
        })
      }, AIInlineCompletionProvider.TIMEOUT_MS)

      let completion = ''
      let ttftMs = -1
      for await (const chunk of this.aiPort.streamCompletion(request, signal)) {
        if (ttftMs < 0) {
          ttftMs = timer.elapsed()
          clearTimeout(timeoutId)
          // Tracked only after the first token; aborted requests don't count.
          this.aiPort.sendTelemetry('completion_requested', {
            language: this.language,
            model: 'haiku',
            prefixLength: request.prefix.length,
            suffixLength: request.suffix.length,
            hasProjectContext: !!request.projectContext,
          })
        }
        completion += chunk
      }

      this.releaseSignedOutHold()

      completion = AIInlineCompletionProvider.stripMarkdownFences(completion)

      if (!completion.trim()) {
        this.aiPort.sendTelemetry('completion_empty', {
          language: this.language,
          model: 'haiku',
          reason: ttftMs < 0 ? 'no_tokens' : 'whitespace_only',
          latencyMs: timer.elapsed(),
        })
        return emptyResult
      }

      // Superseded while streaming: Monaco won't paint it, so don't log it as shown or cache it.
      if (token.isCancellationRequested) return emptyResult

      const item: monaco.languages.InlineCompletion = {
        insertText: completion,
        range: {
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        },
      }

      const entry: CachedCompletion = { item }
      this.cache.set(cacheKey, entry)
      this.lastResult = {
        text: completion,
        anchorLineNumber: position.lineNumber,
        anchorColumn: position.column,
      }
      this.typeThroughTracked = false

      this.trackShown(model, position, completion, timer.elapsed(), 'network', ttftMs)

      return { items: [item] }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return emptyResult

      const statusCode = (error as { status?: number }).status
      const billing = (error as { billing?: BillingErrorPayload }).billing

      // Completions fail silently, but a 402 must still reach the slice for the exhaustion modal.
      if (statusCode === 402 && billing) {
        openPLCStoreBase.getState().aiActions.setBillingError(billing)
      }

      if (statusCode === 401 || statusCode === 403) {
        this.holdForSignIn()
      }

      this.aiPort.sendTelemetry('completion_error', {
        language: this.language,
        model: 'haiku',
        errorType: statusCode ? 'api_error' : error instanceof Error ? error.name : 'unknown',
        ...(statusCode !== undefined && { statusCode }),
        latencyMs: timer.elapsed(),
      })
      console.warn('[AI Completion]', error instanceof Error ? error.message : error)
      return emptyResult
    } finally {
      clearTimeout(timeoutId)
    }
  }

  freeInlineCompletions(_completions: monaco.languages.InlineCompletions): void {
    this.trackAcceptOrDismiss()
  }

  disposeInlineCompletions(_completions: monaco.languages.InlineCompletions): void {
    this.trackAcceptOrDismiss()
  }

  dispose(): void {
    this.unsubscribeFromStore?.()
    this.unsubscribeFromStore = null
    this.unsubscribeFromPreferences?.()
    this.unsubscribeFromPreferences = null
    this.unsubscribeFromSession?.()
    this.unsubscribeFromSession = null
    this.activeAbortController?.abort()
    this.activeAbortController = null
    this.cache.clear()
    this.clearActiveSuggestion()
  }

  private isHeldForSignIn(): boolean {
    return this.session?.isExpired() === true || Date.now() < this.signedOutUntil
  }

  private holdForSignIn(): void {
    this.signedOutUntil = Date.now() + this.signedOutHoldMs
    this.signedOutHoldMs = Math.min(this.signedOutHoldMs * 2, AIInlineCompletionProvider.SIGNED_OUT_HOLD_MAX_MS)
  }

  private releaseSignedOutHold(): void {
    this.signedOutUntil = 0
    this.signedOutHoldMs = AIInlineCompletionProvider.SIGNED_OUT_HOLD_MS
  }

  private clearActiveSuggestion(): void {
    this.lastResult = null
    this.typeThroughTracked = false
  }

  private trackShown(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    completionText: string,
    latencyMs: number,
    source: 'network' | 'cache' | 'type_through',
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
      model: 'haiku',
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
      } else if (shownDurationMs >= AIInlineCompletionProvider.MIN_SHOWN_MS) {
        this.aiPort.sendTelemetry('completion_dismissed', {
          language: this.language,
          completionLength: text.length,
          shownDurationMs,
        })
      }
    } catch {
      if (shownDurationMs >= AIInlineCompletionProvider.MIN_SHOWN_MS) {
        this.aiPort.sendTelemetry('completion_dismissed', {
          language: this.language,
          completionLength: text.length,
          shownDurationMs,
        })
      }
    }
  }

  // On a match the item spans anchor->cursor with `typed + remainder`; Monaco strips the typed prefix.
  private tryTypeThrough(model: monaco.editor.ITextModel, position: monaco.Position): TypeThroughResult {
    const active = this.lastResult
    if (!active) return { kind: 'none' }

    const original = active.text
    const anchorLine = active.anchorLineNumber
    const anchorColumn = active.anchorColumn

    if (position.lineNumber !== anchorLine) return { kind: 'none' }
    if (position.column < anchorColumn) return { kind: 'none' }

    const line = model.getLineContent(position.lineNumber)
    const typed = line.substring(anchorColumn - 1, position.column - 1)

    // Nothing typed yet: defer to the cache lookup, whose prefix hash validates the context.
    if (typed.length === 0) return { kind: 'none' }

    const consumed = tolerantPrefixMatch(original, typed)
    if (consumed === null) return { kind: 'diverged' }
    if (consumed >= original.length) return { kind: 'consumed' }

    const lineSuffix = line.substring(position.column - 1)
    const remainder = reconcileAutoClosed(original.slice(consumed), lineSuffix)
    if (remainder.length === 0) return { kind: 'consumed' }

    const item: monaco.languages.InlineCompletion = {
      insertText: typed + remainder,
      range: {
        startLineNumber: anchorLine,
        startColumn: anchorColumn,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      },
    }
    return { kind: 'match', item, matchedChars: typed.length, completionLength: original.length }
  }

  private static estimateMaxTokens(
    textBeforeCursor: string,
    position: monaco.Position,
    model: monaco.editor.ITextModel,
  ): number {
    const textAfterCursor = model
      .getLineContent(position.lineNumber)
      .substring(position.column - 1)
      .trim()

    if (textAfterCursor.length > 0) return 64

    // After assignment, comma or open paren: single expression.
    if (/(:=|,|\()\s*$/.test(textBeforeCursor)) return 96

    return 256
  }

  private static stripMarkdownFences(text: string): string {
    let result = text.replace(/^\s*<COMPLETION>/, '').replace(/<\/COMPLETION>\s*$/, '')

    const fenceMatch = result.match(/^```[\w]*\n([\s\S]*?)\n?```\s*$/)
    if (fenceMatch) {
      result = fenceMatch[1]
    } else {
      result = result.replace(/^```[\w]*\n/, '')
      result = result.replace(/\n?```\s*$/, '')
    }

    // A completion starting with a blank line renders as an invisible ghost; keep the first line's indent.
    result = result.replace(/^(?:[ \t]*\n)+/, '')

    return result
  }
}
