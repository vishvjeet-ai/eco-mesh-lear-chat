import Constants from 'expo-constants';
import { create } from 'zustand';
import { addMessage, clearChats, getContacts, getMessages, markChatRead, saveContact, updateMessage, type ChatMessage, type Contact } from '../data/database';
import { MessageMachine } from '../lib/messageMachine';
import { decodeRx, DEFAULT_DEVICE_PREFIX, UUIDS, type BleUuids, type NodeStatus } from '../lib/protocol';
import { FakeTransport } from '../transport/fakeTransport';
import type { BleTransport, DiscoveredNode } from '../transport/types';

type Link = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'reconnecting';
type AppState = {
  contacts: Contact[]; messages: ChatMessage[]; demoMode: boolean; link: Link; error: string; devices: DiscoveredNode[]; status: NodeStatus | null; connectedName: string;
  uuids: BleUuids; devicePrefix: string; darkMode: boolean | null;
  init(): Promise<void>; addContact(name: string, id: number): Promise<void>; send(peer: number, text: string): Promise<number>;
  retry(rowid: number): Promise<void>; markRead(peer: number): Promise<void>; setDemoMode(value: boolean): Promise<void>; setUuid(key: keyof typeof UUIDS, value: string): void;
  setDevicePrefix(value: string): void; setDarkMode(value: boolean | null): void; clearAllChats(): Promise<void>;
  startScan(): Promise<void>; stopScan(): Promise<void>; connect(device: DiscoveredNode): Promise<void>; disconnect(): Promise<void>;
};

let transport: BleTransport | null = null;
let transportCleanups: Array<() => void> = [];
const machine = new MessageMachine();
let reconnectCount = 0;
let requestedDisconnect = false;
let scanTimeout: ReturnType<typeof setTimeout> | null = null;
function replaceTransport(next: BleTransport): void {
  transportCleanups.forEach(cleanup => cleanup()); transportCleanups = [];
  if (transport && 'destroy' in transport && typeof transport.destroy === 'function') transport.destroy();
  transport = next;
}
function report(error: unknown): string { return error instanceof Error ? error.message : 'Something went wrong. Try again.'; }
async function addIncoming(peer: number, text: string, store: (fn: (state: AppState) => Partial<AppState>) => void): Promise<void> {
  const state = useAppStore.getState();
  if (!state.contacts.some(contact => contact.id === peer)) await saveContact({ id: peer, name: `Node ${peer.toString(16).toUpperCase().padStart(4, '0')}` });
  await addMessage({ peer, dir: 'in', text, state: 'DELIVERED', msg_id: null, ts: Date.now() });
  const [contacts, messages] = await Promise.all([getContacts(), getMessages()]);
  store(() => ({ contacts, messages }));
}

export const useAppStore = create<AppState>((set, get) => ({
  contacts: [], messages: [], demoMode: false, link: 'disconnected', error: '', devices: [], status: null, connectedName: '', uuids: UUIDS, devicePrefix: DEFAULT_DEVICE_PREFIX, darkMode: null,
  async init() { try { const [contacts, messages] = await Promise.all([getContacts(), getMessages()]); set({ contacts, messages }); } catch (error) { set({ error: `Could not open local chat history. ${report(error)}` }); } },
  async addContact(name, id) {
    if (id < 0 || id > 0xffff || !Number.isInteger(id)) throw new Error('Enter a 4-digit hexadecimal node ID from 0000 to FFFF.');
    if (get().contacts.some(contact => contact.id === id)) throw new Error('A contact with this node ID already exists.');
    await saveContact({ id, name: name.trim() }); set({ contacts: await getContacts() });
  },
  async send(peer, text) {
    const localId = await addMessage({ peer, dir: 'out', text, state: 'SENDING', msg_id: null, ts: Date.now() });
    machine.begin(localId); set({ messages: await getMessages(), error: '' });
    try {
      if (!transport || get().link !== 'connected') throw new Error('The relay node is not connected. Connect again, then tap the failed message to retry.');
      await transport.write(peer, text); machine.writeSucceeded(localId); const next = machine.get(localId)!; await updateMessage(localId, next.state); set({ messages: await getMessages() });
    } catch (error) { machine.writeFailed(localId); await updateMessage(localId, 'FAILED'); set({ messages: await getMessages(), error: report(error) }); }
    return localId;
  },
  async retry(rowid) { const message = get().messages.find(item => item.rowid === rowid); if (!message || message.dir !== 'out') return; await updateMessage(rowid, 'SENDING', null); machine.begin(rowid); set({ messages: await getMessages() }); try { if (!transport || get().link !== 'connected') throw new Error('The relay node is not connected. Connect again, then tap this message to retry.'); await transport.write(message.peer, message.text); machine.writeSucceeded(rowid); const next = machine.get(rowid)!; await updateMessage(rowid, next.state); } catch (error) { machine.writeFailed(rowid); await updateMessage(rowid, 'FAILED'); set({ error: report(error) }); } set({ messages: await getMessages() }); },
  async markRead(peer) { await markChatRead(peer); set({ messages: await getMessages() }); },
  async setDemoMode(value) { if (get().link === 'connected') await get().disconnect(); set({ demoMode: value, error: '' }); },
  setUuid(key, value) { set(state => ({ uuids: { ...state.uuids, [key]: value } })); }, setDevicePrefix(value) { set({ devicePrefix: value }); }, setDarkMode(value) { set({ darkMode: value }); },
  async clearAllChats() { await clearChats(); set({ messages: [] }); },
  async startScan() {
    if (scanTimeout) clearTimeout(scanTimeout);
    set({ link: 'scanning', devices: [], error: '' });
    if (get().demoMode) { replaceTransport(new FakeTransport()); set({ devices: [{ id: 'demo-node-0001', name: 'LEAR Demo Node', rssi: -42 }], link: 'disconnected' }); return; }
    if (Constants.executionEnvironment === 'storeClient') { set({ link: 'disconnected', error: 'BLE needs the LEAR Chat development build. Expo Go can only run in Demo mode.' }); return; }
    try {
      const module = await import('../transport/blePlxTransport'); const ble = new module.BlePlxTransport(get().devicePrefix, get().uuids); replaceTransport(ble);
      await ble.scan(device => set(state => state.devices.some(item => item.id === device.id) ? {} : ({ devices: [...state.devices, device].sort((a,b) => (b.rssi ?? -999) - (a.rssi ?? -999)) })), message => set({ error: message, link: 'disconnected' }));
      scanTimeout = setTimeout(() => { void ble.stopScan(); if (get().link === 'scanning') set({ link: 'disconnected' }); }, 12000);
    } catch (error) { set({ link: 'disconnected', error: report(error) }); }
  },
  async stopScan() { if (scanTimeout) { clearTimeout(scanTimeout); scanTimeout = null; } await transport?.stopScan(); if (get().link === 'scanning') set({ link: 'disconnected' }); },
  async connect(device) {
    if (scanTimeout) { clearTimeout(scanTimeout); scanTimeout = null; }
    set({ link: 'connecting', error: '', status: null, connectedName: device.name }); requestedDisconnect = false; reconnectCount = 0;
    try { await transport?.stopScan(); if (!transport) { if (get().demoMode) replaceTransport(new FakeTransport()); else throw new Error('Scan for a node before connecting.'); }
      const current = transport!;
      transportCleanups = [
        current.onRx(bytes => { try { const packet = decodeRx(bytes); if (packet.type === 'message') void addIncoming(packet.src, packet.text, set); else { const rowid = machine.delivery(packet.msgId, packet.state); if (rowid !== null) { const next = machine.get(rowid)!; void updateMessage(rowid, next.state, next.msgId).then(() => getMessages()).then(messages => set({ messages })); } } } catch (error) { set({ error: `Could not read a message from the node. ${report(error)}` }); } }),
        current.onStatus(status => set({ status })),
        current.onDisconnect(error => { machine.clearPendingIds(); if (requestedDisconnect) return; void reconnect(error); }),
      ];
      await current.connect(device.id); set({ link: 'connected' });
    } catch (error) { transportCleanups.forEach(cleanup => cleanup()); transportCleanups = []; await transport?.disconnect(); set({ link: 'disconnected', error: report(error) }); }
  },
  async disconnect() { requestedDisconnect = true; machine.clearPendingIds(); await transport?.disconnect(); set({ link: 'disconnected', status: null, connectedName: '' }); },
}));

async function reconnect(cause?: Error): Promise<void> {
  const store = useAppStore.getState();
  if (reconnectCount >= 3) { useAppStore.setState({ link: 'disconnected', error: `${cause?.message ?? 'The Bluetooth link dropped.'} Reconnect failed three times. Move closer to the node and connect again.` }); return; }
  reconnectCount += 1; useAppStore.setState({ link: 'reconnecting', error: `Link dropped. Reconnecting (${reconnectCount}/3)…` }); machine.clearPendingIds();
  await new Promise(resolve => setTimeout(resolve, 1500));
  if (!transport || requestedDisconnect) return;
  try { await transport.connect(store.devices.find(device => device.name === store.connectedName)?.id ?? ''); reconnectCount = 0; useAppStore.setState({ link: 'connected', error: '' }); }
  catch (error) { if (reconnectCount < 3) void reconnect(error as Error); else useAppStore.setState({ link: 'disconnected', error: `${report(error)} Reconnect failed three times. Move closer to the node and connect again.` }); }
}
