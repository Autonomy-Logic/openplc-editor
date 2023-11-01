/* eslint-disable react/jsx-no-bind */
/* eslint-disable consistent-return */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable no-console */
/* eslint-disable import/no-cycle */
import useOpenPLCStore from '@/renderer/store';
import './config/index';
import { Editor } from '@monaco-editor/react';
import { useCallback, useRef } from 'react';
import { useTabs } from '@/renderer/hooks';
import * as monaco from 'monaco-editor';
import _ from 'lodash';

export default function TextEditor() {
  const project = useOpenPLCStore.useProjectData();
  const test = useOpenPLCStore.useTest();
  const setTest = useOpenPLCStore.useSetTest();
  const { tabs } = useTabs();
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  function handleEditorInstance(editor: monaco.editor.IStandaloneCodeEditor) {
    // here is the editor instance
    // you can store it in `useRef` for further usage
    editorRef.current = editor;
  }

  const setEditor = useCallback(() => {
    const currentTab = tabs.find((tab) => tab.current);
    if (currentTab?.title === 'program0') {
      return 'program0';
    }
    return 'function0';
  }, [test, tabs]);

  const verifyEditor = useCallback(() => {
    if (editorRef.current) {
      const normalizedUri = editorRef.current
        .getModel()
        ?.uri.path.replace('/', '');
      return normalizedUri;
    }
    return null;
  }, []);

  const debounce = useCallback(
    _.debounce((_editorValue) => {
      const fileToEdit = verifyEditor();
      if (fileToEdit === 'program0') {
        setTest({
          editorForProgram: _editorValue,
        });
      } else {
        setTest({
          editorForFunction: _editorValue,
        });
      }
    }, 750),
    [],
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleChange = (value: any, _event: any) => {
    debounce(value);
  };

  // console.log('State ->', fileToEdit);
  console.log('Store ->', project);

  return (
    <Editor
      path={setEditor()}
      onMount={handleEditorInstance}
      onChange={handleChange}
    />
  );
}

// editor.IStandaloneCodeEditor
