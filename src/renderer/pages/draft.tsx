import { Folder } from 'renderer/components/ui/recent-projects/folder';

function Draft() {
  return (
    <Folder.Root>
      <Folder.Label projectName='Project Draft' lastModified='Within 30 minutes' />
      <Folder.Shape />
    </Folder.Root>
  );
}

export default Draft;
