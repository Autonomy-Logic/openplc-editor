import { CloseIcon, MaximizeIcon, MinimizeIcon } from "./icons"

export const MaximizeButton = () => {
  return (
    <button
      type='button'
      className='flex h-full items-center justify-center px-[10px] hover:bg-[#021633] hover:dark:bg-neutral-850'
      onClick={() => window.bridge.maximizeWindow()}
    >
      <MaximizeIcon />
    </button>
  )
}

export const MinimizeButton = () => {
  return (
    <button
      type='button'
      className='flex h-full items-center justify-center px-[10px] hover:bg-[#021633] hover:dark:bg-neutral-850'
      onClick={() => window.bridge.minimizeWindow()}
    >
      <MinimizeIcon />
    </button>
  )
}

export const CloseButton = () => {
  return (
    <button
      type='button'
      className='flex h-full items-center justify-center px-[10px] hover:bg-red-600'
      onClick={() => window.bridge.closeWindow()}
    >
      <CloseIcon />
    </button>
  )
}
