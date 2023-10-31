/* eslint-disable react-hooks/exhaustive-deps */
import { ReactNode, useEffect, useRef } from 'react';
import './config/index';
import * as monaco from 'monaco-editor';

// eslint-disable-next-line no-restricted-globals
self.MonacoEnvironment = {
  getWorkerUrl(_moduleId: any, label: string) {
    if (label === 'json') {
      return './json.worker.bundle.js';
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return './css.worker.bundle.js';
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return './html.worker.bundle.js';
    }
    if (label === 'typescript' || label === 'javascript') {
      return './ts.worker.bundle.js';
    }
    return './editor.worker.bundle.js';
  },
};

// eslint-disable-next-line react/function-component-definition, import/prefer-default-export
export function TextEditor(): ReactNode {
  const divEl = useRef<HTMLDivElement>(null);
  let editor: monaco.editor.IStandaloneCodeEditor;
  useEffect(() => {
    if (divEl.current) {
      editor = monaco.editor.create(divEl.current, {
        value: ['function x() {', '\tconsole.log("Hello world!");', '}'].join(
          '\n',
        ),
        language: 'typescript',
      });
    }
    return () => {
      editor.dispose();
    };
  }, []);
  return <div className="Editor" ref={divEl} />;
}
