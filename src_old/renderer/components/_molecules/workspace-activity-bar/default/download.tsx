import { DownloadIcon } from '@root/renderer/assets'
import { ActivityBarButton } from '@root/renderer/components/_atoms/buttons'
import { ComponentPropsWithoutRef } from 'react'

// TODO: Refactor this component to use the new compiler service and handle the build process correctly.
// This component should handle the build process and call the compiler service to generate the program object.
// The build process should be handled by the compiler service and the function call should be handled by the bridge.
const DownloadButton = (props: ComponentPropsWithoutRef<'button'>) => {
  return (
    <ActivityBarButton aria-label='Download' {...props}>
      <DownloadIcon />
    </ActivityBarButton>
  )
}

export { DownloadButton }
