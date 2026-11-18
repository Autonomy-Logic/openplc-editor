/** One named store of responses keyed by URL: the shape of the Cache Storage API's `Cache`. */
export interface RuntimeFileStore {
  match(url: string): Promise<Response | undefined>
  put(url: string, response: Response): Promise<void>
  delete(url: string): Promise<boolean>
}

/** The origin's named stores: the shape of the Cache Storage API's `CacheStorage`. */
export interface RuntimeFileStores {
  open(name: string): Promise<RuntimeFileStore>
  keys(): Promise<string[]>
  delete(name: string): Promise<boolean>
}
