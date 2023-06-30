import {
  createContext,
  FC,
  PropsWithChildren,
  ReactNode,
  useCallback,
  useState,
} from 'react'

import { Modal } from '@/components'

export type ModalContextData = {
  isOpen: boolean
  handleOpenModal: () => void
  handleCloseModal: () => void
  setModalContent?: (content: ReactNode | JSX.Element) => void
  setModalHideCloseButton?: (value: boolean) => void
}

export const ModalContext = createContext<ModalContextData>(
  {} as ModalContextData,
)

const ModalProvider: FC<PropsWithChildren> = ({ children }) => {
  const [content, setContent] = useState<ReactNode | JSX.Element>()
  const [open, setOpen] = useState(false)
  const [hideCloseButton, setHideCloseButton] = useState(false)

  const setModalContent = useCallback(
    (content: ReactNode | JSX.Element) => setContent(content),
    [],
  )

  const handleOpenModal = useCallback(() => setOpen(true), [])
  const handleCloseModal = useCallback(() => setOpen(false), [])
  const setModalHideCloseButton = useCallback(
    (value: boolean) => setHideCloseButton(value),
    [],
  )

  return (
    <ModalContext.Provider
      value={{
        isOpen: open,
        setModalContent,
        handleOpenModal,
        handleCloseModal,
        setModalHideCloseButton,
      }}
    >
      {children}
      {content && (
        <Modal
          open={open}
          onClose={setOpen}
          content={content}
          hideCloseButton={hideCloseButton}
        />
      )}
    </ModalContext.Provider>
  )
}

export default ModalProvider
