// Types for CSS Modules imports: each class name in the file becomes a string key.
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}
