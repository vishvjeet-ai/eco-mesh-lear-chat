import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { useAppStore } from '../state/appStore';

export default function RootLayout() {
  const init = useAppStore(state => state.init); const darkMode = useAppStore(state => state.darkMode); const system = useColorScheme();
  useEffect(() => { void init(); }, [init]);
  return <>
    <StatusBar style={(darkMode ?? system === 'dark') ? 'light' : 'dark'} />
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="chat/[peer]" />
      <Stack.Screen name="connect" options={{ presentation: 'modal' }} />
      <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
    </Stack>
  </>;
}
