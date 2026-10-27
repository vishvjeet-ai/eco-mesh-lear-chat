import { encodeTx, utf8Bytes } from '../lib/protocol';
import type { BleTransport, DiscoveredNode } from './types';
import type { NodeStatus } from '../lib/protocol';

export class FakeTransport implements BleTransport {
  private rxListeners = new Set<(bytes: Uint8Array) => void>();
  private statusListeners = new Set<(status: NodeStatus) => void>();
  private disconnectListeners = new Set<(error?: Error) => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private nextMessageId = 1;
  async scan(onDevice: (device: DiscoveredNode) => void): Promise<void> {
    const timer = setTimeout(() => onDevice({ id: 'demo-node-0001', name: 'LEAR Demo Node', rssi: -42 }), 500);
    this.timers.add(timer);
  }
  async stopScan(): Promise<void> {}
  async connect(): Promise<void> {
    const timer = setTimeout(() => this.statusListeners.forEach(listener => listener({ nodeId: 1, battery: 87, queueLength: 0, linkState: 2 })), 150);
    this.timers.add(timer);
  }
  async disconnect(): Promise<void> { this.disconnectListeners.forEach(listener => listener()); }
  async write(destination: number, text: string): Promise<void> {
    encodeTx(destination, text);
    const id = this.nextMessageId++ & 0xffff;
    const peer = destination;
    const timer = setTimeout(() => this.rxListeners.forEach(listener => listener(new Uint8Array([2, id >> 8, id & 255, 1]))), 300);
    this.timers.add(timer);
    const delivered = setTimeout(() => this.rxListeners.forEach(listener => listener(new Uint8Array([2, id >> 8, id & 255, 2]))), 2000);
    this.timers.add(delivered);
    const echo = setTimeout(() => {
      const bytes = utf8Bytes(`Got it: ${text}`);
      this.rxListeners.forEach(listener => listener(new Uint8Array([1, peer >> 8, peer & 255, ...bytes])));
    }, 3500);
    this.timers.add(echo);
  }
  onRx(listener: (bytes: Uint8Array) => void): () => void { this.rxListeners.add(listener); return () => this.rxListeners.delete(listener); }
  onStatus(listener: (status: NodeStatus) => void): () => void { this.statusListeners.add(listener); return () => this.statusListeners.delete(listener); }
  onDisconnect(listener: (error?: Error) => void): () => void { this.disconnectListeners.add(listener); return () => this.disconnectListeners.delete(listener); }
}
