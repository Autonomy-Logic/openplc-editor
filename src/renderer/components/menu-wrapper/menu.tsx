import { OpenIcon, PlusIcon, QuitIcon, TutorialsIcon } from '@/renderer/assets/icons';

export default function Menu() {
  return (
    <div className='h-52 bg-white mr-6 text-xl text-[#030303]'>
      <div className='flex flex-col h-full justify-between'>
        <div className='flex flex-col justify-between flex-grow'>
          <button className='w-full h-9 text-white  bg-[#0464FB] hover:opacity-90 rounded-md flex items-center'>
            <PlusIcon className='w-4 h-4 mx-2 my-2' />
            <p className='my-2'>New Project</p>
          </button>
          <button className='w-full flex items-center  gap-2'>
            <OpenIcon className='w-6 h-fit' />
            Open
          </button>
          <button className='w-full  flex items-center gap-2 '>
            <TutorialsIcon className='w-6 h-fit' />
            Tutorials
          </button>
        </div>
        <hr className='bg-[#DDE2E8] w-full my-4' />
        <div className='flex '>
          <button className='  w-full flex items-center gap-2'>
            <QuitIcon className='w-6 h-fit' />
            Quit
          </button>
        </div>
      </div>
    </div>
  );
}
