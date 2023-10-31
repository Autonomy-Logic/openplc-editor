/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useRef, useState } from 'react';
import './config/index';
import * as monaco from 'monaco-editor';

function TextEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  let editor: monaco.editor.IStandaloneCodeEditor;
  useEffect(() => {
    if (containerRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      editor = monaco.editor.create(containerRef.current, {
        value: 'Hello, World!',
        language: 'il',
        theme: 'OpenPLC',
      });
    }

    return () => {
      editor.dispose();
    };
  }, []);

  return <div ref={containerRef} id="editor" className="h-screen w-screen" />;
}

export default TextEditor;
