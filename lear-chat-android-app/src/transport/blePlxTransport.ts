import { Alert, PermissionsAndroid, Platform } from 'react-native';
import type { NodeStatus } from '../lib/protocol';
import { base64ToBytes, bytesToBase64, decodeStatus, UUIDS as DEFAULT_UUIDS, encodeTx, type BleUuids } from '../lib/protocol';
import type { BleTransport, DiscoveredNode } from './types';

type NativeDevice = { id: string; name?: string | null; rssi?: number | null; serviceUUIDs?: string[] | null; discoverAllServicesAndCharacteristics(): Promise<NativeDevice>; requestMTU(mtu: number): Promise<NativeDevice>; monitorCharacteristicForService(service: string, characteristic: string, callback: (error: Error | null, value: { value?: string | null } | null) => void): { remove(): void }; readCharacteristicForService(service: string, characteristic: string): Promise<{ value?: string | null }>; writeCharacteristicWithResponseForService(service: string, characteristic: string, value: string): Promise<unknown>; cancelConnection(): Promise<unknown>; isConnected(): Promise<boolean>; createBond?(): Promise<unknown> };
type Manager = { startDeviceScan(uuids: string[] | null, options: unknown, callback: (error: Error | null, device: NativeDevice | null) => void): void; stopDeviceScan(): void; state(): Promise<string>; connectToDevice(id: string, options?: unknown): Promise<NativeDevice>; onDeviceDisconnected(id: string, callback: (error: Error | null, device: NativeDevice | null) => void): { remove(): void }; destroy(): void };

/** Loads native BLE only when a real development build requests this transport. */
export async function requestBlePermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const api = Number(Platform.Version);
  const permissions = api >= 31
    ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
    : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const missing: string[] = [];
  for (const permission of permissions) if (await PermissionsAndroid.check(permission)) continue; else missing.push(permission);
  if (!missing.length) return;
  const continueToPermissions = await new Promise<boolean>(resolve => Alert.alert('Bluetooth access', 'LEAR Chat uses Bluetooth to find and connect to your nearby relay node. Messages stay on your local mesh.', [{ text: 'Continue', onPress: () => resolve(true) }, { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) }], { cancelable: false }));
  if (!continueToPermissions) throw new Error('Bluetooth permission is needed to find a relay node. Allow it to continue.');
  const result: Record<string, string> = {};
  for (const permission of missing) result[permission] = await PermissionsAndroid.request(permission as never, {
    title: 'Allow Bluetooth for LEAR Chat',
    message: 'Bluetooth is needed to find your nearby relay node.', buttonPositive: 'Allow', buttonNegative: 'Not now',
  });
  const denied = Object.entries(result).filter(([, value]) => value !== PermissionsAndroid.RESULTS.GRANTED).map(([key]) => key);
  if (denied.length) throw new Error('Bluetooth permission was denied. Allow Nearby devices (and Location on older Android) in Settings, then try again.');
}

export class BlePlxTransport implements BleTransport {
  private manager: Manager | null = null;
  private device: NativeDevice | null = null;
  private disposers: Array<() => void> = [];
  private rxListeners = new Set<(bytes: Uint8Array) => void>();
  private statusListeners = new Set<(status: NodeStatus) => void>();
  private disconnectListeners = new Set<(error?: Error) => void>();
  private prefix = 'LEAR';
  private uuids: BleUuids = DEFAULT_UUIDS;
  constructor(prefix = 'LEAR', uuids: BleUuids = DEFAULT_UUIDS) { this.prefix = prefix; this.uuids = uuids; }
  private getManager(): Manager {
    if (!this.manager) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { BleManager } = require('react-native-ble-plx');
      this.manager = new BleManager();
    }
    return this.manager!;
  }
  
  async scan(onDevice: (device: DiscoveredNode) => void, onError: (message: string) => void): Promise<void> {
    await requestBlePermissions();
    const manager = this.getManager();
    const state = await manager.state();

    if (state === 'PoweredOff')
      throw new Error('Bluetooth is off. Turn it on to connect.');

    if (state === 'Unauthorized')
      throw new Error('Bluetooth permission is unavailable.');

    manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) {
        onError(this.describeError(error));
        return;
      }

      if (!device) return;

      onDevice({
        id: device.id,
        name: device.name ?? `Unknown Device (${device.id.slice(0, 6)})`,
        rssi: device.rssi ?? null
      });
    });
  }

  async stopScan(): Promise<void> { this.manager?.stopDeviceScan(); }
  async connect(deviceId: string): Promise<void> {
    await requestBlePermissions();
    const manager = this.getManager();
    try {
      const state = await manager.state();
      if (state === 'PoweredOff') throw new Error('Bluetooth is off. Turn it on to connect.');
      if (state === 'Unauthorized') throw new Error('Bluetooth permission is unavailable. Allow Nearby devices in Settings, then try again.');
      let device = await manager.connectToDevice(deviceId, { autoConnect: false, timeout: 12000 }) as NativeDevice;
      try { device = await device.requestMTU(247); } catch { /* Some peripherals negotiate their maximum MTU during connection. */ }
      device = await device.discoverAllServicesAndCharacteristics();
      this.device = device;
      const disconnection = manager.onDeviceDisconnected(deviceId, error => {
        this.device = null; this.clearSubscriptions(); this.disconnectListeners.forEach(listener => listener(error ?? undefined));
      });
      this.disposers.push(() => disconnection.remove());
      // Use callbacks directly to keep native subscriptions owned by this transport.
      const rx = device.monitorCharacteristicForService(this.uuids.service, this.uuids.rx, (error, value) => {
        if (error) { this.disconnectListeners.forEach(listener => listener(error)); return; }
        if (value?.value) { try { const decoded = base64ToBytes(value.value); this.rxListeners.forEach(listener => listener(decoded)); } catch (caught) { this.disconnectListeners.forEach(listener => listener(caught as Error)); } }
      });
      const status = device.monitorCharacteristicForService(this.uuids.service, this.uuids.status, (error, value) => {
        if (error || !value?.value) return;
        try { const decoded = decodeStatus(base64ToBytes(value.value)); this.statusListeners.forEach(listener => listener(decoded)); } catch { /* Ignore malformed status advertisements. */ }
      });
      this.disposers.push(() => rx.remove(), () => status.remove());
      const firstStatus = await device.readCharacteristicForService(this.uuids.service, this.uuids.status);
      if (firstStatus.value) { const decoded = decodeStatus(base64ToBytes(firstStatus.value)); this.statusListeners.forEach(listener => listener(decoded)); }
    } catch (error) { throw new Error(this.describeError(error as Error)); }
  }
  async disconnect(): Promise<void> {
    const device = this.device; this.device = null; this.clearSubscriptions();
    if (device) try { await device.cancelConnection(); } catch { /* Already disconnected. */ }
  }
  async write(destination: number, text: string): Promise<void> {
    if (!this.device) throw new Error('The relay node is disconnected. Connect again and retry this message.');
    await this.device.writeCharacteristicWithResponseForService(this.uuids.service, this.uuids.tx, bytesToBase64(encodeTx(destination, text)));
  }
  onRx(listener: (bytes: Uint8Array) => void): () => void { this.rxListeners.add(listener); return () => this.rxListeners.delete(listener); }
  onStatus(listener: (status: NodeStatus) => void): () => void { this.statusListeners.add(listener); return () => this.statusListeners.delete(listener); }
  onDisconnect(listener: (error?: Error) => void): () => void { this.disconnectListeners.add(listener); return () => this.disconnectListeners.delete(listener); }
  destroy(): void { void this.disconnect(); this.manager?.destroy(); this.manager = null; }
  private clearSubscriptions(): void { this.disposers.splice(0).forEach(dispose => { try { dispose(); } catch { /* Native listener already removed. */ } }); }
  private describeError(error: Error): string {
    const message = error?.message ?? 'Unknown Bluetooth error';
    if (/powered off|bluetooth.*off|adapter.*off/i.test(message)) return 'Bluetooth is off. Turn it on to connect.';
    if (/timeout|not found|does not exist|not connected|out of range/i.test(message)) return 'Could not reach that node. Move closer, wake the node, and scan again.';
    if (/permission|unauthorized|denied/i.test(message)) return 'Bluetooth permission was denied. Allow Nearby devices in Settings, then try again.';
    if (/bond|pair|authentication|passkey/i.test(message)) return 'Pairing did not complete. Confirm the passkey shown on the node’s OLED in Android’s pairing dialog, then reconnect.';
    return `${message}. Keep the node nearby and try connecting again.`;
  }
}
