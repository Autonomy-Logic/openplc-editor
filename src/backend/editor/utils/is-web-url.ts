/** True for an `http(s):` URL — the only kind `shell.openExternal` is handed. */
export function isWebUrl(candidate: string): boolean {
  try {
    const { protocol } = new URL(candidate)

    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}
