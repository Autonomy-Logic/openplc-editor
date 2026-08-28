/**
 * Monaco cancels in-flight work by *rejecting* with an error it names
 * `Canceled`. Every debounced editor contribution — the word-occurrences
 * highlighter, folding, link detection — owns a `Delayer` whose pending
 * promise is rejected the moment the editor is disposed, and nothing inside
 * Monaco attaches a `catch` to it. So an editor torn down while any Delayer is
 * still armed leaves an unhandled rejection behind:
 *
 *     Canceled: Canceled
 *       at Delayer.cancel
 *       at WordHighlighter.dispose
 *       at DisposableMap.dispose
 *
 * It is not a failure — the work was cancelled on purpose, which is exactly
 * what disposal means. But it reaches `window` as an unhandled rejection, and
 * in a dev build the bundler's error overlay covers the whole app with it,
 * which is how this was found: stashing from the source-control panel reloads
 * the project, that unmounts the open POU editor, and the overlay then blocked
 * every click until it was dismissed.
 *
 * The one existing workaround for the same rejection turns the highlighter off
 * outright (`occurrencesHighlight: 'off'` in the library-manifest editor). That
 * is fine for a JSON manifest with nothing worth highlighting, and wrong for
 * the POU editors, where highlighting a variable's other occurrences is the
 * point. Swallowing just the cancellation keeps the feature.
 *
 * Deliberately narrow: only a rejection whose reason carries Monaco's own
 * `Canceled` name is suppressed. Any other rejection still surfaces.
 */

const isMonacoCancellation = (reason: unknown): boolean => reason instanceof Error && reason.name === 'Canceled'

/**
 * Installs the listener on `window`. Safe to call more than once: the same
 * function reference is passed to `addEventListener`, so a repeat call is a
 * no-op rather than a second handler.
 */
export const installMonacoCancellationGuard = (): void => {
  window.addEventListener('unhandledrejection', handleUnhandledRejection)
}

function handleUnhandledRejection(event: PromiseRejectionEvent): void {
  if (!isMonacoCancellation(event.reason)) return
  event.preventDefault()
}
