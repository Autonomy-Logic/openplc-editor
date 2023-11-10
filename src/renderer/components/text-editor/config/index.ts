import './languages/il/il.register';
import './themes/open-plc/openplc.register';
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';

loader.config({ monaco });
loader.init();

export {};
