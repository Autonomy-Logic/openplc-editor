/**
 * Monaco InlineCompletionsProvider powered by the AI backend.
 *
 * Web-exclusive — all AI business logic (caching, abort handling, streaming,
 * telemetry, store subscriptions) lives here, not in the shared frontend.
 */
import type * as monaco from 'monaco-editor'

import type { AICompleteParams, AICompletionLanguage, AIPort } from '../../../middleware/shared/ports/ai-port'
import type { EdgeSessionState } from '../../../middleware/shared/ports/edge-account-port'
import type { BillingErrorPayload } from '../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../store'
import { buildFIMContext } from './context-builder'
import { isImeComposing } from './ime-state'

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

/**
 * Resolve after `ms`, or early with `false` if the Monaco cancellation token
 * fires first. Monaco cancels the prior provideInlineCompletions token on every
 * new document change, so a keystroke (including a backtrack that re-matches the
 * suggestion) supersedes a pending divergence re-request automatically.
 */
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

/**
 * How many characters of `suggestion` are consumed by `typed`, tolerating
 * whitespace differences (tab vs space, collapsed runs). Returns the consumed
 * length in suggestion coordinates, or `null` if `typed` diverges from the
 * suggestion (a non-whitespace mismatch, or typing past the suggestion's end).
 */
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

/**
 * Trim from the end of `remainder` any trailing run of closing characters that
 * the editor has already auto-inserted into the line after the cursor (e.g. the
 * `)` Monaco adds when the user types `(`). Without this, the ghost text would
 * duplicate the closer (VS Code #170527 / Monaco #4189).
 */
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

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

type CachedCompletion = {
  item: monaco.languages.InlineCompletion
}

/** The suggestion currently shown, used as the basis for type-through. */
type ActiveSuggestion = {
  /** Full suggested text (the original insertText). */
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

/** Outcome of comparing what the user has typed against the active suggestion. */
type TypeThroughResult =
  /** No active suggestion to type through, or the cursor moved off its line. */
  | { kind: 'none' }
  /** Typed text matches the suggestion — keep it, render `item` (shrunk ghost text). */
  | { kind: 'match'; item: monaco.languages.InlineCompletion; matchedChars: number; completionLength: number }
  /** Typed text equals the whole suggestion — it has been fully consumed. */
  | { kind: 'consumed' }
  /** Typed text diverges from the suggestion — invalidate and re-request. */
  | { kind: 'diverged' }

export class AIInlineCompletionProvider implements monaco.languages.InlineCompletionsProvider {
  private activeAbortController: AbortController | null = null
  private readonly cache = new CompletionCache<CachedCompletion>(16)
  /** The current active suggestion (full text + anchor), or null. */
  private lastResult: ActiveSuggestion | null = null
  /** Whether the one-shot `type_through` impression has been reported for `lastResult`. */
  private typeThroughTracked = false
  private lastShown: ShownCompletion | null = null
  private static readonly TIMEOUT_MS = 5000
  /**
   * How long to wait for typing to settle before firing a network request.
   *
   * Monaco calls `provideInlineCompletions` on every keystroke and only renders
   * the result of its latest call. Debouncing EVERY network path (not just
   * divergence) means that while the user types fast, each superseded call is
   * cancelled during this wait and returns empty; only the settled (latest) call
   * survives to fetch — so the completion we log as shown is the one Monaco
   * actually paints. Cache hits and type-through matches bypass this and stay
   * instant. Kept modest so a pause feels responsive against the model round-trip.
   */
  private static readonly REQUEST_DEBOUNCE_MS = 300
  /** Minimum time (ms) a completion must be visible to count as a real user impression. */
  private static readonly MIN_SHOWN_MS = 300

  /**
   * No requests while the account is known signed-out (a 401/403 on the last one).
   *
   * Monaco asks on every keystroke, and each ask used to cost an IPC round trip plus a
   * telemetry event that could only fail the same way. Held for a widening backoff, or
   * until the session is restored where the caller wired one in.
   */
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
    // Subscribe to project state changes that affect completion context.
    // When variables, data types, or POUs change, cached completions are stale.
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

    // Clear cached completions when the user disables inline suggestions, so nothing stale
    // surfaces if they re-enable later.
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

    // Check if AI is enabled and inline completions are turned on
    const aiState = openPLCStoreBase.getState().ai
    if (!aiState.isEnabled) return emptyResult
    if (!aiState.preferences.inlineCompletionsEnabled) return emptyResult

    // Don't interfere with IME composition (e.g. CJK): intermediate composition
    // characters must not be read as type-through divergence or trigger requests.
    if (isImeComposing()) return emptyResult

    if (this.isHeldForSignIn()) return emptyResult

    const offset = model.getOffsetAt(position)
    const lineContent = model.getLineContent(position.lineNumber)
    const textBeforeCursor = lineContent.substring(0, position.column - 1)

    // Skip only if the editor is completely empty (no context to complete from)
    if (offset === 0 && textBeforeCursor.trim().length === 0) return emptyResult

    const prefixForHash = model.getValue().substring(Math.max(0, offset - 200), offset)
    const cacheKey = buildCacheKey(model.uri.toString(), offset, hashString(prefixForHash))

    // 1. Type-through: if the user is typing the characters we already suggested,
    //    keep the suggestion alive and shrink the ghost text instead of re-requesting.
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

    // 2. Cache lookup (instant) — serves undo/redo and revisited cursor positions.
    const cached = this.cache.get(cacheKey)
    if (cached) {
      this.trackShown(model, position, cached.item.insertText as string, 0, 'cache')
      return { items: [cached.item] }
    }

    // 3. Debounce EVERY network request (cold and divergent alike). Waiting for
    //    typing to settle is what makes the latest provide() call the one that
    //    fetches — superseded calls are cancelled during this wait and return
    //    empty, so Monaco renders the same result we log as shown. Any new
    //    keystroke (including a backtrack that re-matches the suggestion) cancels
    //    the token and supersedes this request.
    const elapsed = await abortableDelay(AIInlineCompletionProvider.REQUEST_DEBOUNCE_MS, token)
    if (!elapsed || token.isCancellationRequested) return emptyResult

    // 4. Cancel any still-in-flight request from a superseded call.
    if (this.activeAbortController) {
      this.activeAbortController.abort()
    }

    if (token.isCancellationRequested) return emptyResult

    // Held in a local as well as on the instance: the field is nullable and a
    // later call reassigns it, so reading `signal` off the field would depend on
    // narrowing that not every type-checker in this repo's toolchain keeps.
    const controller = new AbortController()
    this.activeAbortController = controller
    const { signal } = controller

    token.onCancellationRequested(() => {
      this.activeAbortController?.abort()
    })

    // 5. Build FIM context
    const fimContext = buildFIMContext(model, position, this.pouName, this.language)

    // 6. Stream completion
    const timer = startTimer()
    let _timedOut = false

    // Timeout must be declared outside try so it can be cleared in catch/finally
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

      // 6a. Start client-side timeout — abort if no first token within TIMEOUT_MS
      // Capture the current abort controller so stale timeouts can't kill newer requests
      const localAbortController = this.activeAbortController
      timeoutId = setTimeout(() => {
        _timedOut = true
        localAbortController?.abort()
        // Unconditional, like every other diagnostic in this file. It used to be
        // behind `import.meta.env.DEV`, which is a Vite-only expression and does
        // not compile in the desktop build now that this module is shared. `debug` rather
        // than `warn`: a developer with the console at verbose sees it in any build, while a
        // production console is not handed a warning per timed-out completion.
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
          // Track only after first token — aborted requests don't count
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

      // A request that went through means the account works again.
      this.releaseSignedOutHold()

      // Strip markdown fences the model sometimes adds
      completion = AIInlineCompletionProvider.stripMarkdownFences(completion)

      // Empty completion — the stream finished but produced nothing usable.
      // Distinguish the two shapes so the AI dashboard can separate "model
      // returned no tokens at all" (ttftMs < 0, nothing ever streamed) from
      // "model streamed only whitespace/fences that stripped to nothing".
      // This is the client-side half of the backend `outcome:'empty'` signal.
      if (!completion.trim()) {
        this.aiPort.sendTelemetry('completion_empty', {
          language: this.language,
          model: 'haiku',
          reason: ttftMs < 0 ? 'no_tokens' : 'whitespace_only',
          latencyMs: timer.elapsed(),
        })
        return emptyResult
      }

      // Bail if this call was superseded while streaming. Monaco only renders the
      // result of its latest provideInlineCompletions call; returning (and logging
      // as shown) a stale result here is exactly the "completion_shown but nothing
      // painted" bug. Skipping the cache/lastResult write also keeps type-through
      // from comparing against a suggestion the user never saw.
      if (token.isCancellationRequested) return emptyResult

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

      const entry: CachedCompletion = { item }
      this.cache.set(cacheKey, entry)
      // This becomes the active suggestion type-through compares against. The anchor
      // is the cursor at request time; the text is the full suggested completion.
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

      // Inline completion fails silently by design (no surfacing UI), but a
      // 402 here is the same billing block that would gate the chat. Persist
      // it on the slice so the exhaustion-modal consumer (DOPE-285) has a
      // single source of truth — next chat interaction will pop the modal.
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

  /** Cancel any active request (called on dispose) */
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

  /** Forget the active suggestion so type-through stops comparing against it. */
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

  /**
   * Detect whether the user accepted or dismissed the last shown completion.
   * Completions visible for less than MIN_SHOWN_MS are ignored — they were replaced
   * by the next keystroke before the user could read them.
   */
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

  /**
   * Compare what the user has typed since the active suggestion appeared against
   * that suggestion. Single-line (v1): only engages while the cursor stays on the
   * anchor line at/after the anchor column.
   *
   * On a match we return an item whose `range` spans the anchor→cursor text and
   * whose `insertText` is exactly `typed + remainder`. Monaco strips the common
   * prefix (the typed text) and renders only `remainder` as ghost text — so the
   * suggestion visibly shrinks as the user types it, with no re-request.
   */
  private tryTypeThrough(model: monaco.editor.ITextModel, position: monaco.Position): TypeThroughResult {
    const active = this.lastResult
    if (!active) return { kind: 'none' }

    const original = active.text
    const anchorLine = active.anchorLineNumber
    const anchorColumn = active.anchorColumn

    // Single-line only, and never before the anchor (a backtrack past it).
    if (position.lineNumber !== anchorLine) return { kind: 'none' }
    if (position.column < anchorColumn) return { kind: 'none' }

    const line = model.getLineContent(position.lineNumber)
    const typed = line.substring(anchorColumn - 1, position.column - 1)

    // Cursor sits exactly at the anchor — nothing typed through yet. Defer to the
    // cache lookup, which validates the surrounding context via its prefix hash
    // (so a stale suggestion at a coincidentally-equal column isn't resurfaced).
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

  /**
   * Estimate a reasonable maxTokens cap based on cursor context.
   * Mid-line completions are almost always short expressions; new-line/block
   * starts may need multi-line output. Capping output tokens reduces total
   * stream time without affecting TTFT.
   */
  private static estimateMaxTokens(
    textBeforeCursor: string,
    position: monaco.Position,
    model: monaco.editor.ITextModel,
  ): number {
    const textAfterCursor = model
      .getLineContent(position.lineNumber)
      .substring(position.column - 1)
      .trim()

    // Mid-line: completing an expression before existing code — keep it short
    if (textAfterCursor.length > 0) return 64

    // After assignment, comma, or open paren: likely a single expression
    if (/(:=|,|\()\s*$/.test(textBeforeCursor)) return 96

    // Default: new line or block start — allow multi-line completions
    return 256
  }

  /**
   * Normalizes a raw model completion before it becomes ghost text.
   *
   * The backend uses a "hole filler" prompt: the model is prefilled with
   * `<COMPLETION>` and stops on `</COMPLETION>`, so the streamed text is
   * normally clean code. This strips three artifacts defensively:
   *  1. a stray `<COMPLETION>` / `</COMPLETION>` wrapper (if the model echoes
   *     the tag instead of relying on the prefill/stop);
   *  2. markdown code fences (some models still wrap code in ``` );
   *  3. all leading blank lines — the `<COMPLETION>` prefill / hole-filler
   *     reliably emits one or more (especially on an empty line after a
   *     comment), which would insert a blank line and render an invisible ghost
   *     at the cursor, or break a mid-expression completion like
   *     `YellowTime := \nT#1000ms`.
   */
  private static stripMarkdownFences(text: string): string {
    let result = text.replace(/^\s*<COMPLETION>/, '').replace(/<\/COMPLETION>\s*$/, '')

    const fenceMatch = result.match(/^```[\w]*\n([\s\S]*?)\n?```\s*$/)
    if (fenceMatch) {
      result = fenceMatch[1]
    } else {
      result = result.replace(/^```[\w]*\n/, '')
      result = result.replace(/\n?```\s*$/, '')
    }

    // Drop ALL leading blank lines the assistant prefill / hole-filler induces
    // (it commonly emits `\n` or `\n\n` before the code, especially when the
    // cursor is on an empty line after a comment). A completion that begins with
    // a blank line renders as an invisible ghost at the cursor — the visible
    // text is pushed a line down — which reads as "no suggestion". `[ \t]*\n`
    // peels whole blank / whitespace-only leading lines while preserving the
    // indentation of the first real line of code.
    result = result.replace(/^(?:[ \t]*\n)+/, '')

    return result
  }
}
