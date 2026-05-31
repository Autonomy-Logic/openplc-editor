import { BaseElement } from './BaseElement';
import { Connection } from './Connection';
import { ElementState } from '../../types/ElementState';

export class ContactElement extends BaseElement {
  private normallyClosed: boolean = false;
  private inputValue: boolean = false;

  constructor(id: string, x: number, y: number) {
    super(id, x, y, 'contact');
  }

  setNormallyClosed(nc: boolean): void {
    this.normallyClosed = nc;
    this.updateOutput();
  }

  setInput(value: boolean): void {
    this.inputValue = value;
    this.updateOutput();
  }

  private updateOutput(): void {
    const outputValue = this.normallyClosed ? !this.inputValue : this.inputValue;
    this.setOutput(0, outputValue);
    this.propagateSignal(outputValue);
  }

  private propagateSignal(value: boolean): void {
    const outputConnections = this.getOutputConnections(0);
    outputConnections.forEach((connection: Connection) => {
      connection.setSignal(value);
    });
  }

  getState(): ElementState {
    return {
      ...super.getState(),
      normallyClosed: this.normallyClosed,
      inputValue: this.inputValue
    };
  }

  setState(state: ElementState): void {
    super.setState(state);
    if (state.normallyClosed !== undefined) {
      this.normallyClosed = state.normallyClosed;
    }
    if (state.inputValue !== undefined) {
      this.inputValue = state.inputValue;
    }
    this.updateOutput();
  }
}