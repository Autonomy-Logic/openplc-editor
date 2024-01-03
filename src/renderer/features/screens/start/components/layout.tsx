import { DisplayExampleProjects, DisplayRecentProjects } from './elements';

export default function Layout() {
  return (
    <div className='w-full h-screen flex pl-[92px] pr-[70px]'>
      <h1 className='flex-1'>Teste</h1>
      <div className='flex flex-col flex-1 max-w-[968px]'>
        <DisplayExampleProjects />
        <DisplayRecentProjects />
      </div>
    </div>
  );
}
