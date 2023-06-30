import { ReactNode, useContext, useEffect } from 'react'

import { ModalContext } from '@/contexts'
import { ModalContextData } from '@/contexts/Modal'

export type UseModalProps = {
  content?: ReactNode | JSX.Element
  hideCloseButton?: boolean
}

const useModal = (props?: UseModalProps): ModalContextData => {
  const context = useContext(ModalContext)

  if (!context) throw new Error('useModal must be used within a ModalProvider')

  const { setModalContent, setModalHideCloseButton, ...rest } = context

  useEffect(() => {
    if (props) {
      const { content, hideCloseButton } = props
      if (content && setModalContent) setModalContent(content)
      if (hideCloseButton && setModalHideCloseButton)
        setModalHideCloseButton(hideCloseButton)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return rest
}

export default useModal
