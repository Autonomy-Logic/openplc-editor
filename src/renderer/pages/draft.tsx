import RecentProjects from '../../shared/data/mock/projects-data.json';
import MenuWrapper from '../components/menu-wrapper';
import RecentProjectViewer from '../components/recent-project';

function Draft() {
  return (
    
    <div className='w-full h-full bg-white flex justify-center items-center'>
      <MenuWrapper />
      <RecentProjectViewer dataToRender={RecentProjects} />
    </div>
  );
}

export default Draft;
