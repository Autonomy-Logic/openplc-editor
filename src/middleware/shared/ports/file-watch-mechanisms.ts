/** The platform mechanisms a file-watch registry drives. */
export interface FileWatchMechanisms {
  watchFile(path: string, onChange: (curr: { mtimeMs: number }, prev: { mtimeMs: number }) => void): void
  unwatchFile(path: string): void
  stat(path: string): Promise<{ mtimeMs: number }>
  statSync(path: string): { mtimeMs: number }
  /** One key per file, whatever separator or case the path arrives in. */
  canonicalPath(path: string): string
  emitExternalChange(rendererPath: string): void
}
