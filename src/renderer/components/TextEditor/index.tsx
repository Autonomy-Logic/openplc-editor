/* eslint-disable react/jsx-no-bind */
/* eslint-disable consistent-return */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable no-console */
/* eslint-disable import/no-cycle */
import useOpenPLCStore from '@/renderer/store';
import './config/index';
import { Editor } from '@monaco-editor/react';
import { useCallback, useEffect, useRef } from 'react';
import { useTabs } from '@/renderer/hooks';
import * as monaco from 'monaco-editor';
import _ from 'lodash';

export default function TextEditor() {
  const project = useOpenPLCStore.useProjectData();
  const updatePou = useOpenPLCStore.useUpdatePou();
  const { tabs } = useTabs();
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  function handleEditorInstance(editor: monaco.editor.IStandaloneCodeEditor) {
    // here is the editor instance
    // you can store it in `useRef` for further usage
    editorRef.current = editor;
  }
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
      if (!fileToEdit) return;
      updatePou(fileToEdit, _editorValue);
    }, 750),
    [],
  );

  const handleChange = (
    value: string | undefined,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _ev: monaco.editor.IModelContentChangedEvent,
  ) => {
    debounce(value);
  };

  const setEditorPath = useCallback(() => {
    const currentTab = tabs.find((tab) => tab.current);
    if (currentTab) {
      return currentTab.title;
    }
    return '';
  }, [tabs]);

  const setPouInStage = useCallback(() => {
    const currentTab = setEditorPath();
    if (!currentTab || !project) return 'Empty pou in stage';
    const pouInStage = project.project.types.pous.pou.find(
      (p) => p['@name'] === currentTab,
    );
    const res = JSON.stringify(pouInStage?.body);
    return res;
  }, [tabs]);

  useEffect(() => {
    setPouInStage();
  }, [tabs]);

  window.bridge.saveProject((_event, value) => {
    console.warn(value);
  });

  return (
    <Editor
      path={setEditorPath()}
      defaultValue={setPouInStage()}
      onMount={handleEditorInstance}
      onChange={handleChange}
    />
  );
}

// editor.IStandaloneCodeEditor
