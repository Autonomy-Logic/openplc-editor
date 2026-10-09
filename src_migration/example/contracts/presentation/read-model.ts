export type Unsubscribe = () => void

/**
 * Observable, immutable view state. `getSnapshot` returns the same object until the data it
 * projects changes, so it can back `useSyncExternalStore` directly. `subscribe` only notifies;
 * readers call `getSnapshot` again to get the new value.
 */
export interface ReadModel<T> {
  readonly getSnapshot: () => T
  readonly subscribe: (listener: () => void) => Unsubscribe
}
