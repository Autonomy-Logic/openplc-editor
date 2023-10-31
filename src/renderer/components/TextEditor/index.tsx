import useOpenPLCStore from '@/renderer/store';
import './config/index';
import { Editor } from '@monaco-editor/react';
import { useCallback, useEffect, useState } from 'react';
// eslint-disable-next-line import/no-cycle
import { useTabs } from '@/renderer/hooks';
import { PouShape } from '@/types/common/pou';

export default function TextEditor() {
  const [fileToEdit, setFileToEdit] = useState<PouShape | null>();
  const project = useOpenPLCStore.useProjectData();
  const { tabs } = useTabs();

  const getCurrentTab = useCallback(() => {
    return tabs.find((tab) => tab.current);
  }, [tabs]);

  const getCurrentPou = useCallback(
    (tb: string) => {
      if (project) {
        return project.project.types.pous.pou.find(
          (pou) => pou['@name'] === tb,
        );
      }
      return null;
    },
    [project],
  );

  useEffect(() => {
    const tab = getCurrentTab();
    if (!tab) return;
    const pou = getCurrentPou(tab.title);
    if (!pou) return;
    setFileToEdit(pou);

    console.log(fileToEdit);

    // eslint-disable-next-line consistent-return
    return () => setFileToEdit(null);
  }, [fileToEdit, getCurrentPou, getCurrentTab]);
  return (
    <Editor path={fileToEdit?.['@name']} value={fileToEdit?.['@pouType']} />
  );
}
