import { CompletionItem, CompletionItemKind, Position, TextDocument } from 'vscode';
import { VariableDeclaration } from '../../parser/VariableDeclaration';
import { DataType } from '../../parser/DataType';
import { StructType } from '../../parser/StructType';

export class AutocompleteProvider {
  private variables: VariableDeclaration[] = [];
  private dataTypes: DataType[] = [];

  public setVariables(variables: VariableDeclaration[]): void {
    this.variables = variables;
  }

  public setDataTypes(dataTypes: DataType[]): void {
    this.dataTypes = dataTypes;
  }

  public provideCompletionItems(document: TextDocument, position: Position): CompletionItem[] {
    const lineText = document.getText(
      document.lineAt(position.line).range
    );
    
    const textBeforeCursor = lineText.substring(0, position.character);
    
    // Check if we're accessing a struct member (variable.member)
    const structMemberMatch = textBeforeCursor.match(/([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)?$/);
    if (structMemberMatch) {
      const variableName = structMemberMatch[1];
      const partialMember = structMemberMatch[2] || '';
      
      // Find the variable
      const variable = this.variables.find(v => v.name === variableName);
      if (variable) {
        // Find the struct type
        const structType = this.findStructType(variable.type);
        if (structType) {
          // Return struct members
          return structType.members
            .filter(member => member.name.startsWith(partialMember))
            .map(member => {
              const item = new CompletionItem(member.name, CompletionItemKind.Field);
              item.detail = `${member.type} ${member.name}`;
              return item;
            });
        }
      }
      return [];
    }
    
    // Default behavior - return top-level variables
    return this.variables
      .map(variable => {
        const item = new CompletionItem(variable.name, CompletionItemKind.Variable);
        item.detail = `${variable.type} ${variable.name}`;
        return item;
      });
  }

  private findStructType(typeName: string): StructType | undefined {
    const dataType = this.dataTypes.find(dt => dt.name === typeName);
    if (dataType && dataType instanceof StructType) {
      return dataType as StructType;
    }
    return undefined;
  }
}