# Agent Network App

📱 Minimal native mobile client for [Agent Network / CommHub](https://github.com/sleep2agi/agent-network) — Android first, iOS from the same codebase.

Built with **Expo (React Native, TypeScript)**. Design language follows the dashboard's less-is-more overhaul (near-black surfaces, restrained color, green/red/amber/gray status colors).

## Features (MVP)

- **Login** — server URL + token, with a connection probe before entering
- **Agents** — live fleet list: status dot, current task one-liner, pull-to-refresh, 10s polling
- **Chat** — tap an agent card to chat; opens with the newest 20 messages and lazy-loads older history as you scroll up; send via `/api/send_task`
- Settings (token persistence, theme, logout) — in progress

## Development

```bash
npm install
npx expo start        # Expo Go / dev client
npx tsc --noEmit      # typecheck
```

## Android build (local, no EAS)

Requires JDK 17 and the Android SDK (API 35). Userspace install works:

```bash
export JAVA_HOME=~/android-tools/jdk-17.0.19+10
export ANDROID_HOME=~/android-tools/sdk
npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

## Tracking

Progress is reported on [sleep2agi/agent-network#220](https://github.com/sleep2agi/agent-network/issues/220).
