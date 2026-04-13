# PlatformProvider Wiring Guide

How to wire the PlatformProvider into each application root.

## Strategy

The migration lives in `src2/` — a parallel source directory that will eventually
replace `src/` once all components are migrated and tested. The original `src/`
remains untouched and fully functional throughout the migration.

## Directory Structure

```
src/                              <-- ORIGINAL, untouched during migration
  renderer/ (editor) or . (web)
    components/
    hooks/
    store/
    ...

src2/                             <-- MIGRATION target, new architecture
  providers/
    platform/
      index.ts                    <-- exports PlatformProvider, usePlatform, convenience hooks
      platform-context.tsx        <-- React context + hooks (SHARED, identical in both repos)
      types.ts                    <-- PlatformPorts aggregate type (SHARED)
      ports/                      <-- Port interfaces (SHARED, identical in both repos)
        types.ts
        compiler-port.ts
        runtime-port.ts
        debugger-port.ts
        simulator-port.ts
        project-port.ts
        device-port.ts
        system-port.ts
        window-port.ts
        accelerator-port.ts
        theme-port.ts
        platform-capabilities.ts
        index.ts
  adapters/
    editor-platform.ts            <-- (editor only) Electron IPC implementations
    web-platform.ts               <-- (web only) HTTP/WebRTC implementations
  components/                     <-- migrated components (added over time)
  hooks/                          <-- migrated hooks (added over time)
  store/                          <-- migrated store slices (added over time)
```

## Editor Wiring (src2 App root)

```tsx
import { PlatformProvider } from '@src2/providers/platform'
import { editorPorts } from '@src2/adapters/editor-platform'

export default function App() {
  const { project: { meta: { path } } } = useOpenPLCStore()

  return (
    <PlatformProvider ports={editorPorts}>
      <AppLayout>
        {path === '' ? <StartScreen /> : <WorkspaceScreen />}
      </AppLayout>
    </PlatformProvider>
  )
}
```

## Web Wiring (src2 App root)

```tsx
import { PlatformProvider } from '@src2/providers/platform'
import { webPorts } from '@src2/adapters/web-platform'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PlatformProvider ports={webPorts}>
      <RouterProvider router={router} />
    </PlatformProvider>
  </StrictMode>,
)
```

## Using Ports in Components

```tsx
import { usePlatform, useCapabilities, useRuntime } from '@src2/providers/platform'

// Full access to all ports
function WorkspaceActivityBar() {
  const { compiler, runtime, debugger: dbg, capabilities } = usePlatform()

  const handleCompile = async () => {
    await compiler.compileProgram(args, (event) => {
      console.log(event.stage, event.message)
    })
  }

  return (
    <>
      <button onClick={handleCompile}>Compile</button>
      {capabilities.hasNativeWindowControls && <WindowControls />}
      {capabilities.hasAIAssistant && <AIChatPanel />}
    </>
  )
}

// Single port access
function RuntimeLoginModal() {
  const runtime = useRuntime()

  const handleLogin = async (username: string, password: string) => {
    const result = await runtime.login({ username, password })
    if (result.success) { /* ... */ }
  }
}

// Feature toggle
function TitleBar() {
  const caps = useCapabilities()

  return (
    <header>
      {caps.hasNativeMenu ? <NativeMenuSlots /> : <WebMenuBar />}
      {caps.hasNativeWindowControls && <WindowControls />}
    </header>
  )
}
```

## Migration Workflow

1. Pick a component from `src/` that calls `window.bridge.*` or a service directly
2. Identify which port(s) it needs (e.g., RuntimePort for login)
3. Implement the adapter method in `editor-platform.ts` / `web-platform.ts`
4. Copy the component to `src2/`, refactoring it to use `usePlatform()` hooks
5. Verify the migrated component works identically to the original
6. Mark the item as migrated in `migration-tracker.md`

The original `src/` component remains untouched until `src2/` is fully tested.
Each stub port uses a Proxy that throws a descriptive error when called,
so you'll immediately know if a component uses an unmigrated port.

## Cutover

Once all components are migrated and tested in `src2/`:
1. Rename `src/` to `src-legacy/` (keep as backup)
2. Rename `src2/` to `src/`
3. Update build configs and path aliases
4. Run full test suite
5. Remove `src-legacy/` once confident
