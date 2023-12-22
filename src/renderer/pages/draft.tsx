import RecentProjects from '../../shared/data/mock/projects-data.json';
import RecentProjectViewer from '../components/recent-project';

function Draft() {
  return (
    <div className='w-full h-full flex justify-center items-center'>
      <RecentProjectViewer dataToRender={RecentProjects} />
    </div>
  );
}

export default Draft;
