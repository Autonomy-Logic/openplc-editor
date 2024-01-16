/* eslint-disable react/jsx-no-bind */
/* eslint-disable consistent-return */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable no-console */
/* eslint-disable import/no-cycle */
import './config/index';

import { Editor } from '@monaco-editor/react';
import { IpcRendererEvent } from 'electron/renderer';
import _ from 'lodash';
import * as monaco from 'monaco-editor';
import { useCallback, useEffect, useRef } from 'react';

import { useTabs } from '~renderer/hooks';
import { useOpenPLCStore } from '~renderer/store';

export default function TextEditor() {
  const projectPath = useOpenPLCStore.useProjectPath();
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
      const normalizedUri = editorRef.current.getModel()?.uri.path.replace('/', '');
      return normalizedUri;
    }
    return null;
  }, []);

  const debounce = useCallback(
    _.debounce((_editorValue) => {
      const fileToEdit = verifyEditor();
      if (!fileToEdit) return;
      updatePou({ name: fileToEdit, body: _editorValue });
    }, 750),
    []
  );

  const handleChange = (
    value: string | undefined,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _ev: monaco.editor.IModelContentChangedEvent
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
    const pouInStage = project.project.types.pous.pou.find((p) => p['@name'] === currentTab);
    const res = JSON.stringify(pouInStage?.body);
    return res;
  }, [tabs]);

  useEffect(() => {
    setPouInStage();
  }, [tabs]);

  window.bridge.saveProject(async (event: IpcRendererEvent, _value: string) => {
    if (!_value) return;
    const dataToSave = {
      projectPath,
      projectAsObj: project,
    };
    event.sender.send('project:save-response', dataToSave);
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
