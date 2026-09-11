import '@xyflow/react/dist/style.css'
import 'tailwindcss/tailwind.css'
import './backend/shared/styles/globals.css'
// Monaco language + theme registrations (`openplc-dark` / `openplc-light`,
// ST / IL / Python LanguageConfigurations).  Imported here as a
// side-effect at app boot so EVERY Monaco editor in the app — body
// editor, variables text-mode editor, future LSP-driven views — sees
// the registered themes regardless of mount order.  Previously this
// import lived only inside the body editor's index.tsx, which meant
// any editor that mounted first (e.g. variables text-mode opened
// without the body editor) saw Monaco's default vs-dark theme.
import './frontend/components/_features/[workspace]/editor/monaco/configs'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
// Resolve basedpyright's worker bundle URL through the host
// bundler.  Editor uses webpack with an `asset/resource` rule on
// `?url`; web uses Vite's native `?url` query.  The shared
// `startPythonLsp` requires this URL as an option — keeping the
// bundler-specific syntax pinned to the (non-byte-identical)
// `App.tsx` keeps the shared zone clean.  See
// `setPythonLspWorkerUrl` in monaco/python-lsp/index.ts.
import pyrightWorkerUrl from 'browser-basedpyright/dist/pyright.worker.js?url'
import { useCallback, useEffect, useRef } from 'react'

import { AIChatPanel } from './frontend/components/_features/[workspace]/ai-chat'
import { AcuExhaustionModal } from './frontend/components/_features/[workspace]/ai-settings-panel'
import { setPythonLspWorkerUrl } from './frontend/components/_features/[workspace]/editor/monaco/python-lsp'
import { AppLayout } from './frontend/components/_templates/app-layout'
import { StartScreen } from './frontend/screens/start-screen'
import { WorkspaceScreen } from './frontend/screens/workspace-screen'
import { trackAcuExhausted, trackUpgradeCtaClicked } from './frontend/services/ai/telemetry'
import { configureSaveResume } from './frontend/services/resume-save-after-sign-in'
import { bootStLsp } from './frontend/services/st-lsp/boot'
import { openPLCStoreBase, useOpenPLCStore } from './frontend/store'
import { stlibsToSystemLibraries } from './frontend/utils/stlib-to-system-library'
import { getEdgeWebUrl } from './middleware/adapters/editor/system-adapter'
import { transpileProjectStInProcess } from './middleware/adapters/editor/transpile-project-st'
import { editorPorts, setProjectPath, setRuntimeIpAddress } from './middleware/editor-platform'
import { ExtensionPanelProvider, PlatformProvider } from './middleware/shared/providers'

/**
 * Load every installed library (bundled + user-installed) at startup
 * and dispatch the parsed `SystemLibrary` shape into the Zustand
 * library slice.
 *
 * Runs as a top-level promise so libraries hydrate as early as
 * possible — usually before the first render that consumes them, but
 * the store starts with an empty `libraries.system` array regardless
 * and the library tree just renders progressively as entries arrive.
 * Errors bubble up to the console / dev tools; we don't fall back to
 * a hardcoded set because the .stlib files are the canonical source
 * of truth for library content.
 */
const hydrateLibraries = () => {
  // Two parallel calls: archives carry the full POU lists for the
  // tree builder, listInstalled carries the bundled flag (the
  // archive shape doesn't).  Both feed the same slice so the tree
  // and the manager stay in sync.
  Promise.all([editorPorts.library.loadAll(), editorPorts.library.listInstalled()])
    .then(([archives, installed]) => {
      const actions = openPLCStoreBase.getState().libraryActions
      actions.setSystemLibraries(stlibsToSystemLibraries(archives))
      actions.setBundledLibraryNames(installed.filter((l) => l.bundled).map((l) => l.name))
    })
    .catch((err) => {
      console.error('Failed to load .stlib libraries:', err)
    })
}
hydrateLibraries()
// Reload the in-memory pool whenever the main process reports an
// install/uninstall/CDN change.  Subscriber lives outside React to
// catch events fired before any component mounts.
editorPorts.library.onLibrariesChanged(() => hydrateLibraries())

// Register the basedpyright worker URL so the Monaco-side adapter
// can spin up the Python LSP on first POU open.  No service
// start yet — the LSP is lazy-initialised in
// `monaco/python-lsp/initPythonLSP` when Monaco mounts.
setPythonLspWorkerUrl(pyrightWorkerUrl)

// Seed the AI slice from the platform config before the first render, so the chat
// entry point and the inline-completion provider see the real consent state instead of
// the store's conservative default and then flipping a frame later.
if (editorPorts.ai) {
  const { setAIEnabled, setAIConsented } = openPLCStoreBase.getState().aiActions
  setAIEnabled(editorPorts.ai.isFeatureEnabled)
  setAIConsented(editorPorts.ai.hasUserConsented)
}

// The save flow asks this before every write whether the session it would write with
// has already ended, and queues the save for replay after sign-in if so. The web wires
// it here in its own composition root; the desktop never did, so `save-actions` took
// the raw-401 branch on every expired session and nothing was ever queued — the user
// signed back in to find their save had simply not happened. Same call, same place.
if (editorPorts.edgeAccount) {
  configureSaveResume(editorPorts.edgeAccount.session)
}

/**
 * One client for the whole app, created at module scope.
 *
 * Only the conversation hooks (`frontend/services/ai/conversations`) use react-query in
 * this build, so the provider below wraps nothing but the chat panel. Creating the
 * client inside a component instead would throw the conversation list away every time
 * the panel remounted — which it does on every open and close.
 */
const aiQueryClient = new QueryClient()

/**
 * The chat panel, with the desktop's ST transpiler and its react-query scope bound in.
 *
 * Declared at module scope so the component keeps its identity across renders of `App`:
 * an inline arrow would be a new component type every render, and React would remount
 * the whole conversation each time.
 *
 * The transpiler is the reason a graphical POU reaches the model as Structured Text
 * rather than as a bag of React Flow nodes. Omit it and LD / FBD questions get answered
 * against a program the assistant cannot actually read.
 *
 * The `QueryClientProvider` sits HERE rather than at the app root deliberately. Nothing
 * outside the AI conversation hooks uses react-query, the panel is the only subtree that
 * calls them, and it only mounts once the user opens the chat — so the narrowest scope
 * that works is also the one that costs a user who never opens the panel nothing.
 */
const EditorChatPanel = () => (
  <QueryClientProvider client={aiQueryClient}>
    <AIChatPanel transpileProject={transpileProjectStInProcess} />
  </QueryClientProvider>
)

/**
 * The ACU exhaustion modal, subscribed to the slice the whole AI surface reports into.
 *
 * Mounted once, outside the panel, because a 402 does not only come from chat: an inline
 * completion can spend the last of someone's credits, and the block has to be explained
 * wherever it happened. Without this the `billing` payload the adapter carefully carries
 * across IPC has nowhere to be shown, and running out of credits looks like a generic
 * error.
 */
const AiBillingNotice = () => {
  const ai = editorPorts.ai
  const billingError = useOpenPLCStore((state) => state.ai.billingError)
  const planSlug = useOpenPLCStore((state) => state.ai.planSlug)
  const setBillingError = useOpenPLCStore((state) => state.aiActions.setBillingError)

  const dismiss = useCallback(() => setBillingError(null), [setBillingError])
  const onUpgradeClick = useCallback(() => {
    if (ai) trackUpgradeCtaClicked(ai, { source: 'modal' })
  }, [ai])

  // Fired once per modal-open. The ref dedupes re-renders of the same payload — a
  // parallel entitlements refresh updates `planSlug` and would otherwise count the same
  // block twice. `code + message` is identity enough: the user has to dismiss before the
  // next 402 can land a new payload.
  const lastTrackedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!ai) return
    if (!billingError) {
      lastTrackedRef.current = null
      return
    }

    const key = `${billingError.code}:${billingError.message}`
    if (lastTrackedRef.current === key) return
    lastTrackedRef.current = key

    trackAcuExhausted(ai, {
      source:
        billingError.code === 'subscription_inactive'
          ? 'subscription'
          : billingError.code === 'rate_limit_exceeded'
            ? 'rate_limit'
            : 'usage_limit',
      planSlug,
      remaining: billingError.remaining ?? null,
    })
  }, [ai, billingError, planSlug])

  return (
    <AcuExhaustionModal
      billingError={billingError}
      onDismiss={dismiss}
      // Deep-links to Edge's `Profile -> Usage` page, where ACU is topped up and a
      // lapsed subscription is reactivated.
      upgradeUrl={`${getEdgeWebUrl()}/profile/settings?tab=usage`}
      onUpgradeClick={onUpgradeClick}
    />
  )
}

// Pre-warm the STruC++ LSP worker so the first ST POU opens with
// completion + diagnostics already streaming.  `bootStLsp` returns
// null when the capability flag is off (web build before its
// adapter lands, jsdom test envs, …).  Lazy-import monaco-editor
// to avoid pulling its top-level side effects into modules that
// only need the boot wrapper.
void import('monaco-editor').then((monaco) => {
  bootStLsp(editorPorts, monaco)
})

export default function App() {
  const {
    project: {
      meta: { path },
    },
  } = useOpenPLCStore()

  // Sync store runtime IP to the platform adapter so the runtime port can access it
  const runtimeIpAddress = useOpenPLCStore((state) => state.deviceDefinitions.configuration.runtimeIpAddress || '')
  useEffect(() => {
    setRuntimeIpAddress(runtimeIpAddress)
  }, [runtimeIpAddress])

  // Sync project path to the platform adapter so the ESI port can access it
  const projectPath = useOpenPLCStore((state) => state.project.meta.path)
  useEffect(() => {
    setProjectPath(projectPath)
  }, [projectPath])

  return (
    <PlatformProvider ports={editorPorts}>
      <AiBillingNotice />
      {/* The workspace screen reads the panel out of this context; without the provider
          `useChatPanel()` answers null and the chat button opens nothing. */}
      <ExtensionPanelProvider panels={{ ChatPanel: EditorChatPanel }}>
        <AppLayout>{path === '' ? <StartScreen /> : <WorkspaceScreen />}</AppLayout>
      </ExtensionPanelProvider>
    </PlatformProvider>
  )
}
