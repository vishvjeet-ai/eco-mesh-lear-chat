# LEAR Chat

LEAR Chat is an offline-first phone client for the LEAR LoRa mesh. The phone sends text to a nearby handheld relay over BLE; the relay carries it over LoRa. The app has no messaging backend and makes no network requests. Contacts, chat history, and settings live on the phone.

## Run the UI in Expo Go

Expo Go does not include the native BLE module. Demo mode is on by default and uses a fake relay, so the UI, local SQLite history, and message state flow work in Expo Go without loading `react-native-ble-plx`.

```sh
cd lear-chat
npm install
npx expo start
```

Open the project in Expo Go, open **Connect to a node**, and connect to **LEAR Demo Node**. A sent message is queued after 0.3 seconds, delivered after 2 seconds, and receives `Got it: <text>` after 3.5 seconds. The simulated relay reports node `0001`, 87% battery, queue length 0, and a good link. To use a real node, turn Demo mode off and install the development build below.

## Make and install the Android development build

Install Node.js 20 or later. From the project folder:

```sh
npm install
npx expo prebuild
npx eas-cli login
npx eas-cli init
npx eas-cli build --platform android --profile development
```

Install the APK from the EAS build link. Start the JavaScript development server with:

```sh
npx expo start --dev-client
```

The native build is required for real BLE. Expo Go is for Demo mode only. If the app config or BLE permissions change, regenerate native projects with `npx expo prebuild --clean` and make a new development build.

## Build the installable preview APK

After signing in and linking this project once with `npx eas-cli init`, run:

```sh
npx eas-cli build --platform android --profile preview
```

The `preview` profile in `eas.json` creates an internally distributable APK. EAS returns a download link when the build finishes. Install that APK on an Android phone and grant Nearby devices permission when prompted. For an iOS development build, use EAS Build or a Mac with Xcode; BLE still requires a native development build.

## BLE contract

UUIDs and the name prefix are editable in **Settings** and have their defaults in `src/lib/protocol.ts`.

| Item | UUID / value | Direction and behavior |
| --- | --- | --- |
| Service | `4c454152-4d45-5348-0001-000000000000` | Advertised LEAR service |
| TX | `4c454152-4d45-5348-0002-000000000000` | Phone writes with response: `[DST_hi, DST_lo, ...UTF-8 text]`, at most 144 text bytes |
| RX | `4c454152-4d45-5348-0003-000000000000` | Node notifies `01 | SRC_hi | SRC_lo | UTF-8 text` or `02 | MSGID_hi | MSGID_lo | state` |
| STATUS | `4c454152-4d45-5348-0004-000000000000` | Node reads/notifies `[NODE_hi, NODE_lo, battery %, queue length, link state]` |
| Name prefix | `LEAR` | Also scan for devices with this name prefix |

16-bit IDs are big-endian. RX delivery states are `1 = QUEUED`, `2 = DELIVERED`, and `3 = FAILED`. STATUS link values are `0 = none`, `1 = weak`, and `2 = good`. Android 12+ uses `BLUETOOTH_SCAN` with `neverForLocation` and `BLUETOOTH_CONNECT`. Android 11 and earlier also need Bluetooth admin and location permissions. Pairing is initiated by the secure BLE link; Android shows the system pairing dialog for the passkey displayed on the handheld OLED.

## Test a handheld with nRF Connect

1. Flash firmware that advertises the service UUID and the `LEAR` device name prefix. Turn on the handheld and keep it close to the phone.
2. In nRF Connect, scan and open the LEAR node. Connect and complete Android’s pairing prompt with the passkey on the OLED.
3. Discover the LEAR service. Read STATUS; expect five bytes: node ID high byte, node ID low byte, battery percentage, queue length, and link quality.
4. Enable notifications on RX and STATUS. RX should notify incoming-message or delivery-status packets using the table above.
5. Write to TX with **Write request / response**. For destination `0001` and text `Hi`, the bytes are `00 01 48 69`. Confirm the firmware queues the message and sends a QUEUED RX status carrying its ID.
6. In LEAR Chat, turn Demo mode off, tap **Connect to node**, select the handheld, and send a short message. Check the app’s queued/delivered ticks and the firmware’s RX/TX log.

## Local development and tests

```sh
npm test
npm run typecheck
npx expo config --type prebuild
```

The packet codec and outgoing-message state machine are plain TypeScript. Jest covers packet encoding/decoding, base64, FIFO message IDs, the notification/write race, and UTF-8 byte counting.
