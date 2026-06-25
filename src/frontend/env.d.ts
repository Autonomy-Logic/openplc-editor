interface ImportMetaEnv {
  readonly [key: string]: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.svg' {
  const content: string
  export default content
}

// `?url` query imports — both webpack 5 (`asset/resource` rule
// with `resourceQuery: /^\?url$/`) and Vite (`?url` query) resolve
// these to the emitted asset URL at build time.  Used at app boot
// to hand bundler-resolved worker URLs to the shared LSP services.
declare module '*?url' {
  const url: string
  export default url
}
