import { useDevice } from '@root/middleware/shared/providers/platform-context'
import { type ReactNode, useEffect, useRef, useState } from 'react'

/** Scrolling pane of the selected slot. `scrollResetKey` brings it back to the top whenever the slot it shows changes. */
function SlotDetailPane({ children, scrollResetKey }: { children: ReactNode; scrollResetKey?: string | number }) {
  const paneRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (paneRef.current) paneRef.current.scrollTop = 0
  }, [scrollResetKey])

  return (
    <div
      ref={paneRef}
      className='flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto rounded-md border border-neutral-200 p-4 dark:border-neutral-700'
    >
      {children}
    </div>
  )
}

function SlotDetailHeading({ slotNumber }: { slotNumber: number }) {
  return (
    <h3 className='mb-3 font-caption text-base font-semibold text-neutral-950 dark:text-white'>Slot {slotNumber}</h3>
  )
}

function ModuleSummary({ description, specs }: { description?: string; specs?: Record<string, string> }) {
  return (
    <>
      {description && <p className='text-xs text-neutral-600 dark:text-neutral-400'>{description}</p>}
      {specs && (
        <dl className='mt-2 flex flex-col gap-0.5 text-xs text-neutral-600 dark:text-neutral-400'>
          {Object.entries(specs).map(([k, v]) => (
            <div key={k} className='flex gap-1'>
              <dt className='font-medium text-neutral-500 dark:text-neutral-400'>{k}:</dt>
              <dd className='text-neutral-700 dark:text-neutral-300'>{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  )
}

/** Fetches the module's package image lazily; draws nothing when there is none or it fails to load. */
function ModulePicture({ image, packagePath, alt }: { image?: string; packagePath?: string; alt: string }) {
  const devicePort = useDevice()
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDataUrl(null)
    if (!image || !packagePath) return
    void devicePort
      .getPreviewImage(image, packagePath)
      .then((url: string) => {
        if (!cancelled) setDataUrl(url || null)
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [image, packagePath, devicePort])

  if (!dataUrl) return null
  return (
    <img
      src={dataUrl}
      alt={alt}
      className='h-auto max-h-[min(20rem,30vh)] w-auto max-w-[40%] self-start object-contain'
    />
  )
}

export { ModulePicture, ModuleSummary, SlotDetailHeading, SlotDetailPane }
