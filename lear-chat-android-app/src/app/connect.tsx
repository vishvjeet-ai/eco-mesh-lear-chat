import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { DiscoveredNode } from '../transport/types';
import { formatNodeId } from '../lib/protocol';
import { palette } from '../theme';
import { useAppStore } from '../state/appStore';

export default function ConnectScreen() {
  const { devices, link, error, demoMode, startScan, stopScan, connect } = useAppStore(useShallow(state => ({ devices: state.devices, link: state.link, error: state.error, demoMode: state.demoMode, startScan: state.startScan, stopScan: state.stopScan, connect: state.connect })));
  const dark = useAppStore(state => state.darkMode) ?? useColorScheme() === 'dark'; const c = dark ? palette.dark : palette.light;
  useEffect(() => { void startScan(); return () => { void stopScan(); }; }, [startScan, stopScan]);
  const choose = async (device: DiscoveredNode) => { await connect(device); if (useAppStore.getState().link === 'connected') router.back(); };
  const busy = link === 'scanning' || link === 'connecting' || link === 'reconnecting';
  return <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]} edges={['top','bottom']}>
    <View style={styles.header}><Pressable onPress={() => { void stopScan(); router.back(); }}><Text style={[styles.back, { color: c.green }]}>‹</Text></Pressable><View style={{ flex: 1 }}><Text style={[styles.eyebrow, { color: c.green }]}>BLUETOOTH LE</Text><Text style={[styles.title, { color: c.text }]}>Connect to a node</Text></View><Pressable style={[styles.scanButton, { backgroundColor: c.mint }]} onPress={() => void startScan()}><Text style={{ color: c.green, fontWeight: '800' }}>Scan again</Text></Pressable></View>
    <View style={[styles.infoCard, { backgroundColor: c.surface, borderColor: c.line }]}><Text style={[styles.infoTitle, { color: c.text }]}>{demoMode ? 'Demo handheld' : 'Keep your node nearby'}</Text><Text style={[styles.infoText, { color: c.muted }]}>{demoMode ? 'A simulated relay is ready. Connect to try the complete chat flow on this phone.' : 'Wake the handheld node and keep it within Bluetooth range. If pairing starts, enter the passkey shown on its OLED in Android’s system dialog.'}</Text></View>
    <View style={styles.section}><Text style={[styles.sectionTitle, { color: c.text }]}>Nearby nodes</Text>{busy && <ActivityIndicator color={c.green} />}</View>
    {!!error && <View style={[styles.error, { backgroundColor: dark ? '#3A2225' : '#FCEAEC' }]}><Text style={{ color: c.danger, fontSize: 12, lineHeight: 18 }}>{error}</Text></View>}
    <ScrollView contentContainerStyle={styles.list}>{devices.map(device => <Pressable key={device.id} onPress={() => void choose(device)} style={[styles.device, { backgroundColor: c.surface, borderColor: c.line }]}><View style={[styles.deviceIcon, { backgroundColor: c.mint }]}><Text style={{ color: c.green, fontWeight: '900', fontSize: 17 }}>⌁</Text></View><View style={{ flex: 1 }}><Text style={[styles.deviceName, { color: c.text }]}>{device.name}</Text><Text style={[styles.deviceDetails, { color: c.muted }]}>{device.id.startsWith('demo') ? 'Node 0001 · Simulated' : `Signal ${device.rssi ?? '—'} dBm`}</Text></View><Text style={[styles.chevron, { color: c.muted }]}>›</Text></Pressable>)}
      {!devices.length && !busy && !error && <View style={styles.noResults}><Text style={[styles.infoText, { color: c.muted }]}>No LEAR node found. Wake the node and scan again.</Text></View>}
    </ScrollView>
    <View style={styles.footer}><Text style={[styles.footerText, { color: c.muted }]}>Node IDs use four hexadecimal digits, such as {formatNodeId(1)}.</Text></View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { flex: 1 }, header: { paddingHorizontal: 20, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }, back: { fontSize: 36, lineHeight: 38, width: 23 }, eyebrow: { fontSize: 9, letterSpacing: 1.8, fontWeight: '800' }, title: { fontSize: 21, fontWeight: '800', marginTop: 3 }, scanButton: { borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9 }, infoCard: { borderRadius: 17, borderWidth: 1, padding: 15, marginHorizontal: 20, marginTop: 9 }, infoTitle: { fontSize: 14, fontWeight: '800' }, infoText: { fontSize: 12, lineHeight: 18, marginTop: 6 }, section: { paddingHorizontal: 22, marginTop: 24, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, sectionTitle: { fontSize: 15, fontWeight: '800' }, error: { marginHorizontal: 20, borderRadius: 13, padding: 12, marginBottom: 9 }, list: { paddingHorizontal: 20, gap: 9 }, device: { borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }, deviceIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, deviceName: { fontSize: 14, fontWeight: '800' }, deviceDetails: { fontSize: 11, marginTop: 4 }, chevron: { fontSize: 23 }, noResults: { padding: 20, alignItems: 'center' }, footer: { padding: 17, alignItems: 'center' }, footerText: { fontSize: 10 } });
