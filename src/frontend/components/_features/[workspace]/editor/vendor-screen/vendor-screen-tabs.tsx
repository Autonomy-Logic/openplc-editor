import { useOpenPLCStore } from '@root/frontend/store'
import { cn } from '@root/frontend/utils/cn'

import { VendorScreenEditor } from './index'

/** One editor per open vendor-screen tab, hidden while inactive, so an embedded configurator keeps its session across tab switches. */
const VendorScreenTabs = () => {
  const editor = useOpenPLCStore((s) => s.editor)
  const editors = useOpenPLCStore((s) => s.editors)
  const activeScreen = editor.type === 'plc-vendor-screen' ? editor.meta.screenName : null

  return (
    <>
      {editors.flatMap((model) =>
        model.type === 'plc-vendor-screen'
          ? [
              <div
                key={model.meta.screenName}
                className={cn(
                  'flex h-full min-h-0 w-full flex-col',
                  model.meta.screenName !== activeScreen && 'hidden',
                )}
              >
                <VendorScreenEditor screenName={model.meta.screenName} />
              </div>,
            ]
          : [],
      )}
    </>
  )
}

export { VendorScreenTabs }
