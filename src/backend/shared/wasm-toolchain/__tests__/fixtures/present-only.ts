/** An `exists` check over a fixed set of present paths, recording what it was asked. */
export const presentOnly = (present: string[]) => {
  const asked: string[] = []
  const exists = (path: string): Promise<boolean> => {
    asked.push(path)
    return Promise.resolve(present.includes(path))
  }
  return { asked, exists }
}
