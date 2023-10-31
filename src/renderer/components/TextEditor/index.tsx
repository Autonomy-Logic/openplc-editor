/* eslint-disable import/no-cycle */
/* eslint-disable no-console */
import './config/index';
import { Editor } from '@monaco-editor/react';
import useOpenPLCStore from 'renderer/store';
import useTabs from 'renderer/hooks/useTabs';
import { useCallback, useEffect, useState } from 'react';

function TextEditor() {
  const [editorValues, setEditorValues] = useState<string | any>('null');
  const pous = useOpenPLCStore.useProjectData();
  const pousDt = pous?.project.types.pous.pou;
  const { tabs } = useTabs();

  const getValues = useCallback(() => {
    const tab = tabs.find((tb) => tb.current)?.title;
    const it = pousDt?.filter((p) => p['@name'] === tab)[0];
    if (it) {
      setEditorValues(it['@name']);
    }
  }, [pousDt, tabs]);

  useEffect(() => {
    getValues();
  }, [getValues]);
  // useEffect(() => {
  //   console.log('found', tabs.find((tb) => tb.current)?.title);

  //   // if (tabs.length === 0) {
  //   //   pous.forEach((pou) => {
  //   //     tabs.push({
  //   //       id: pou['@name'],
  //   //       title: pou['@name'],
  //   //       current: true,
  //   //     });
  //   //   });
  //   // }
  // }, [pous, tabs]);

  return <Editor height="100vh" theme="openplc-light" value={editorValues} />;
}

export default TextEditor;
