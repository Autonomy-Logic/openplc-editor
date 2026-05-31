import { KeyCode, KeyMod } from 'monaco-editor';
import { IEditorService } from './editor-service';

export class EditorKeybindings {
  constructor(private editorService: IEditorService) {}

  public registerKeybindings(): void {
    // Existing keybindings...
    
    // Add TAB key handling for function block parameter completion
    this.editorService.addKeybinding({
      key: KeyCode.Tab,
      when: 'editorTextFocus && !editorReadonly && suggestWidgetVisible',
      command: 'editor.action.triggerSuggest'
    });
  }
}