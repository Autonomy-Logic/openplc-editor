import { Modal, ModalContent, ModalTitle } from '@root/renderer/components/_molecules'
import { produce } from 'immer'
import { useState } from 'react'
import { create } from 'zustand'

import { Step1 } from './steps/first-step'
import { Step2 } from './steps/second-step'
// import { Step3 } from './steps/third-step'

export type NewProjectStoreProps = {
  formData: {
    type: string
    name: string
    path: string
    language: string
    time: string
  }
  setFormData: (form: NewProjectStoreProps['formData']) => void
}

const NewProjectStore = create<NewProjectStoreProps>((setState) => ({
  formData: {
    type: '',
    name: '',
    path: '',
    language: '',
    time: '',
  },
  setFormData: (form: Partial<NewProjectStoreProps['formData']>) => {
    setState(
      produce((state: NewProjectStoreProps) => {
        Object.assign(state.formData, form)
      }),
    )
  },
}))

const ProjectModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const formCurrentState = NewProjectStore((state) => state.formData)
  const [currentStep, setCurrentStep] = useState(1)

  const handleNext = () => {
    setCurrentStep((prevStep) => (prevStep < 3 ? prevStep + 1 : prevStep))
  }

  const handlePrev = () => {
    setCurrentStep((prevStep) => (prevStep > 1 ? prevStep - 1 : prevStep))
  }

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <Step1 onNext={handleNext} />
      case 2:
        return <Step2 onNext={handleNext} onPrev={handlePrev} />
      // case 3:
      //   return <Step3 onPrev={handlePrev} onPrev={handlePrev} />
      default:
        return null
    }
  }

  console.log('State ->', formCurrentState)

  return (
    <Modal open={isOpen} onOpenChange={onClose}>
      <ModalContent onClose={onClose} className='flex h-[450px] flex-col justify-between p-6'>
        <ModalTitle className='absolute -top-10 opacity-0' />
        {renderStep()}
      </ModalContent>
    </Modal>
  )
}

export { NewProjectStore, ProjectModal }
