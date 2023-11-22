/* eslint-disable react/function-component-definition */
/* eslint-disable import/no-cycle */
import { FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Tabs } from 'renderer/components';
import Tree, { RootProps } from 'renderer/components/Tree';
import { useTabs } from 'renderer/hooks';
import useOpenPLCStore from 'renderer/store';

import { CONSTANTS,convertToPath  } from '@/utils';
/**
 * Destructure necessary values from the CONSTANTS module
 */
const { paths } = CONSTANTS;
/**
 * Functional component for displaying the project tree
 * @component
 */
const ProjectTree: FC = () => {
  // Access the project and related functions from store hook
  const project = useOpenPLCStore.useProjectData();
  /**
   * Access the addTab function from custom hook
   * @useTabs
   */
  const { addTab } = useTabs();
  /**
   * State for holding the root structure of the tree
   */
  const [root, setRoot] = useState<RootProps | undefined>();
  /**
   * Access the translation function from 'react-i18next'
   * @useTranslation
   */
  const { t } = useTranslation();
  /**
   * Access the navigation function from 'react-router-dom'
   * @useNavigate
   */
  const navigate = useNavigate();
  /**
   * Extract the product name from the project XML or use an empty string
   */
  const productName = project?.project.fileHeader['@productName'] || '';

  useEffect(() => {
    if (project) {
      const pous = project?.project.types.pous.pou;
      const resourceName =
        project?.project.instances.configurations.configuration.resource[
          '@name'
        ];
      /**
       * Handle click events for tree nodes and add corresponding tabs
       * @function
       */
      const handleClick = (data: {
        id: number | string;
        title: string;
        path: string;
      }) => {
        addTab({
          ...data,
          onClick: () => navigate(data.path),
        });
        navigate(data.path);
      };
      /**
       * Construct the root structure of the tree
       */
      setRoot({
        id: 'root',
        title: 'root',
        children: [
          {
            id: productName,
            title: productName,
            onClick: () =>
              handleClick({
                id: productName,
                title: productName,
                path: paths.PROJECT,
              }),
            isOpen: true,
            children: [
              {
                // TODO: This must differ from pou type
                id: 'programs',
                title: t('programs'),
                isOpen: true,
                children: [
                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                  ...pous.map((pou) => {
                    const pouName = pou['@name'];
                    return {
                      id: pouName,
                      title: pouName,
                      onClick: () =>
                        handleClick({
                          id: pouName,
                          title: pouName,
                          path: convertToPath([paths.EDITOR, pouName]),
                        }),
                    };
                  }),
                ],
              },
              {
                id: resourceName,
                title: resourceName,
                onClick: () =>
                  handleClick({
                    id: resourceName,
                    title: resourceName,
                    path: paths.RES,
                  }),
              },
            ],
          },
        ],
      });
    } else {
      navigate(paths.MAIN);
    }
  }, [addTab, navigate, productName, project, t]);
  /**
   * Render the ProjectTree component
   * @returns JSX Element
   */
  return (
    <>
      <Tabs
        tabs={[
          {
            id: productName,
            title: productName,
            current: true,
          },
        ]}
      />
      <div className="py-4">
        <Tree root={root} />
      </div>
    </>
  );
};

export default ProjectTree;
