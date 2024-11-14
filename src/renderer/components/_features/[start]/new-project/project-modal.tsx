import { Modal, ModalContent, ModalTitle } from '@root/renderer/components/_molecules'
import { useOpenPLCStore } from '@root/renderer/store'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Step1 } from './steps/first-step'
import { Step2 } from './steps/second-step'
import { Step3 } from './steps/third-step'
import { NewProjectStore } from './store'

const ProjectModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const navigate = useNavigate()
  const {
    workspaceActions: { setEditingState },
    tabsActions: { clearTabs },
  } = useOpenPLCStore()
  const resetFormData = NewProjectStore((state) => state.resetFormData)
  const [currentStep, setCurrentStep] = useState(1)

  const handleNext = () => {
    setCurrentStep((prevStep) => (prevStep < 3 ? prevStep + 1 : prevStep))
  }

  const handlePrev = () => {
    setCurrentStep((prevStep) => (prevStep > 1 ? prevStep - 1 : prevStep))
  }

  const handleClose = () => {
    onClose()
  }

  const handleFinishForm = () => {
    onClose()
    navigate('/workspace')
  }

  useEffect(() => {
    setCurrentStep(1)
    resetFormData()
    setEditingState('unsaved')
    clearTabs()
  }, [])

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <Step1 onClose={handleClose} onNext={handleNext} />
      case 2:
        return <Step2 onNext={handleNext} onPrev={handlePrev} />
      case 3:
        return <Step3 onPrev={handlePrev} onFinish={handleFinishForm} onClose={handleClose} />
      default:
        return null
    }
  }

  return (
    <Modal open={isOpen} onOpenChange={handleClose}>
      <ModalContent onClose={handleClose} className='flex h-[450px] flex-col justify-between p-6'>
        <ModalTitle className='absolute -top-10 opacity-0' />
        {renderStep()}
      </ModalContent>
    </Modal>
  )
}

export { ProjectModal }
