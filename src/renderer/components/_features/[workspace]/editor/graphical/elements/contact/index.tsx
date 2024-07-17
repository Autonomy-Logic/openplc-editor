import { Modal, ModalContent, ModalTitle, ModalTrigger } from '@root/renderer/components/_molecules'

const ContactELement = () => {
  return (
    <Modal>
      <ModalTrigger>Open Contact</ModalTrigger>
      <ModalContent onClose={() => {}} className='h-[468px] w-[413px] flex-col gap-8 px-6 py-4'>
        <ModalTitle className='text-xl font-medium text-neutral-950 dark:text-white'>Block Properties</ModalTitle>
        <div className='flex h-[316px] w-full gap-10'>
          <div className='relative h-full w-full text-sm font-medium text-neutral-950'>
            <span>Modifier</span>
            <ul className='mt-4 flex flex-col gap-4 '>
              {['Normal', 'Negated', 'Rising Edge', 'Falling Edge'].map((modifier, index) => (
                <li key={index} className='flex items-center'>
                  <input type='radio' name='modifier' id={modifier} className='mr-2' />
                  <label htmlFor={modifier}>{modifier}</label>
                </li>
              ))}
            </ul>

            <div className='absolute bottom-0 w-full'>
              <p>Variable</p>
              <select className='h-4 w-full'></select>
            </div>
          </div>
          <div className='h-full w-full'></div>
        </div>
        <div className='flex !h-8 w-full gap-1'>
          <button className='h-full w-full items-center rounded-lg bg-brand text-center font-medium text-white'>
            Ok
          </button>
          <button className='h-full w-full items-center rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'>
            Cancel
          </button>
        </div>
      </ModalContent>
    </Modal>
  )
}

export default ContactELement
