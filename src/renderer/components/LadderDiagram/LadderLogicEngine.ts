export class LadderLogicEngine {
  private elements: Map<string, LadderElement> = new Map();
  private signals: Map<string, boolean> = new Map();

  addElement(element: LadderElement): void {
    this.elements.set(element.id, element);
  }

  setSignal(id: string, value: boolean): void {
    this.signals.set(id, value);
  }

  getSignal(id: string): boolean {
    return this.signals.get(id) ?? false;
  }

  evaluate(): void {
    // Reset all signals
    this.signals.clear();
    
    // Set initial input states
    for (const element of this.elements.values()) {
      if (element.type === 'input') {
        this.signals.set(element.id, element.state);
      }
    }

    // Evaluate each rung sequentially
    const rungs = this.getRungs();
    for (const rung of rungs) {
      this.evaluateRung(rung);
    }
  }

  private getRungs(): LadderElement[][] {
    // Group elements into rungs based on their position
    const rungMap = new Map<number, LadderElement[]>();
    
    for (const element of this.elements.values()) {
      const rungIndex = element.position.y;
      if (!rungMap.has(rungIndex)) {
        rungMap.set(rungIndex, []);
      }
      rungMap.get(rungIndex)?.push(element);
    }

    // Sort rungs by y position
    return Array.from(rungMap.values())
      .sort((a, b) => a[0].position.y - b[0].position.y);
  }

  private evaluateRung(rung: LadderElement[]): void {
    // Sort elements in rung by x position
    rung.sort((a, b) => a.position.x - b.position.x);
    
    let rungPowered = true; // Left rail is always powered
    
    for (const element of rung) {
      if (element.type === 'contact') {
        // For contacts, check if input is powered and contact is closed
        const inputPowered = this.getSignal(element.inputId ?? '');
        const contactClosed = element.state;
        const outputPowered = rungPowered && inputPowered && contactClosed;
        this.signals.set(element.id, outputPowered);
        rungPowered = outputPowered;
      } else if (element.type === 'coil') {
        // For coils, set output based on rung power state
        this.signals.set(element.id, rungPowered);
        // Coils don't affect rung power flow
      } else {
        // For other elements, propagate rung power state
        this.signals.set(element.id, rungPowered);
      }
    }
  }
}

interface LadderElement {
  id: string;
  type: 'contact' | 'coil' | 'input' | 'output' | 'branch';
  state: boolean;
  position: { x: number; y: number };
  inputId?: string;
}