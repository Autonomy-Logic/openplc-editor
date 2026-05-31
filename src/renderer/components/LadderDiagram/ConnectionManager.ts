import { LadderElement, ElementType } from './LadderElement';
import { ContactElement } from './elements/ContactElement';
import { CoilElement } from './elements/CoilElement';
import { validateConnection } from './ConnectionValidator';

class ConnectionManager {
  private connections: Map<string, { source: LadderElement; target: LadderElement }> = new Map();

  connect(source: LadderElement, target: LadderElement): boolean {
    if (!validateConnection(source, target)) {
      return false;
    }

    const connectionId = `${source.id}-${target.id}`;
    this.connections.set(connectionId, { source, target });
    return true;
  }

  disconnect(source: LadderElement, target: LadderElement): boolean {
    const connectionId = `${source.id}-${target.id}`;
    return this.connections.delete(connectionId);
  }

  getConnection(source: LadderElement, target: LadderElement) {
    const connectionId = `${source.id}-${target.id}`;
    return this.connections.get(connectionId);
  }

  getConnectionsForElement(element: LadderElement): Array<{ source: LadderElement; target: LadderElement }> {
    const result: Array<{ source: LadderElement; target: LadderElement }> = [];
    
    this.connections.forEach((connection, id) => {
      if (connection.source.id === element.id || connection.target.id === element.id) {
        result.push(connection);
      }
    });

    return result;
  }

  validateContactOutputConnection(source: LadderElement, target: LadderElement): boolean {
    // Contact outputs can only connect to coil inputs or other contact inputs
    if (source.type === ElementType.CONTACT && source instanceof ContactElement) {
      if (target.type === ElementType.COIL && target instanceof CoilElement) {
        return true;
      }
      if (target.type === ElementType.CONTACT && target instanceof ContactElement) {
        return true;
      }
      return false;
    }
    return true;
  }

  propagateSignal(element: LadderElement, signal: boolean): void {
    const connections = this.getConnectionsForElement(element);
    
    connections.forEach(connection => {
      if (connection.source.id === element.id) {
        // Propagate signal to target element
        if (connection.target.setSignal) {
          connection.target.setSignal(signal);
        }
      }
    });
  }

  cleanupDisconnectedElements(): void {
    // Remove connections where source or target elements no longer exist
    const validConnections = new Map<string, { source: LadderElement; target: LadderElement }>();
    
    this.connections.forEach((connection, id) => {
      // In a real implementation, we would check if elements still exist in the diagram
      // For now, we'll assume all connections are valid
      validConnections.set(id, connection);
    });

    this.connections = validConnections;
  }
}

export default ConnectionManager;