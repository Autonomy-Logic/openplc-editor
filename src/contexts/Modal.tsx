import {
  createContext,
  FC,
  PropsWithChildren,
  ReactNode,
  useCallback,
  useState,
} from 'react'

import { Modal } from '@/components'
/**
 * Type representing the data structure of the modal context
 * @interface ModalContextData
 */
export type ModalContextData = {
  isOpen: boolean
  handleOpenModal: () => void
  handleCloseModal: () => void
  setModalContent?: (content: ReactNode | JSX.Element) => void
  setModalHideCloseButton?: (value: boolean) => void
}
/**
 * Create a context for the modal functionality
 * @context
 */
export const ModalContext = createContext<ModalContextData>(
  {} as ModalContextData,
)
/**
 * Define a React component that provides the configured modal.
 * @returns A JSX Component with the modal context provider
 */
const ModalProvider: FC<PropsWithChildren> = ({ children }) => {
  /**
   * State to manage the content of the modal
   */
  const [content, setContent] = useState<ReactNode | JSX.Element>()
  /**
   * State to track the open/close state of the modal
   */
  const [open, setOpen] = useState(false)
  /**
   * State to control whether the close button of the modal is hidden
   */
  const [hideCloseButton, setHideCloseButton] = useState(false)
  /**
   * Set the content of the modal
   */
  const setModalContent = useCallback(
    (content: ReactNode | JSX.Element) => setContent(content),
    [],
  )
  /**
   * Function to open the modal
   */
  const handleOpenModal = useCallback(() => setOpen(true), [])
  /**
   * Function to close the modal
   */
  const handleCloseModal = useCallback(() => setOpen(false), [])
  /**
   * Set whether the close button of the modal should be hidden
   */
  const setModalHideCloseButton = useCallback(
    (value: boolean) => setHideCloseButton(value),
    [],
  )
  /**
   * Provide the context with modal data.
   */
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
