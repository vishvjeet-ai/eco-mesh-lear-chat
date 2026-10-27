import type { NodeStatus } from '../lib/protocol';

export type DiscoveredNode = { id: string; name: string; rssi: number | null };
export interface BleTransport {
  scan(onDevice: (device: DiscoveredNode) => void, onError: (message: string) => void): Promise<void>;
  stopScan(): Promise<void>;
  connect(deviceId: string): Promise<void>;
  disconnect(): Promise<void>;
  write(destination: number, text: string): Promise<void>;
  onRx(listener: (bytes: Uint8Array) => void): () => void;
  onStatus(listener: (status: NodeStatus) => void): () => void;
  onDisconnect(listener: (error?: Error) => void): () => void;
}
