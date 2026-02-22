# homepage-app

Desktop and mobile app built with Tauri 2 + SvelteKit + TypeScript.

## Prerequisites (all platforms)

- [Node.js](https://nodejs.org/) 20+
- [Yarn](https://yarnpkg.com/) package manager
- [Rust](https://www.rust-lang.org/tools/install) stable toolchain

Install frontend dependencies:

```bash
cd homepage-app
yarn install
```

## Development

Run the app in dev mode with hot-reload:

```bash
yarn tauri dev
```

The Vite dev server starts on `http://localhost:1420` and the Tauri window opens automatically.

Run frontend unit tests:

```bash
yarn test
```

## Building for macOS

### Additional prerequisites

- Xcode Command Line Tools (`xcode-select --install`)

### Build

```bash
yarn tauri build
```

The `.dmg` installer is output to:

```
src-tauri/target/release/bundle/dmg/
```

## Building for Windows

### Additional prerequisites

- [Visual Studio](https://visualstudio.microsoft.com/) Build Tools with the "Desktop development with C++" workload
- [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Windows 10 1803+ and Windows 11)

### Build

```bash
yarn tauri build
```

Installers are output to:

```
src-tauri/target/release/bundle/nsis/   # .exe installer
src-tauri/target/release/bundle/msi/    # .msi installer
```

## Building for Android

### Additional prerequisites

- [JDK 17](https://adoptium.net/) (Temurin recommended)
- [Android SDK](https://developer.android.com/studio) with SDK platform installed
- Android NDK `27.0.12077973` — install via SDK Manager or:
  ```bash
  sdkmanager --install "ndk;27.0.12077973"
  ```
- Rust Android target:
  ```bash
  rustup target add aarch64-linux-android
  ```

### Environment variables

Set these before building (adjust paths for your system):

```bash
export JAVA_HOME=/path/to/jdk-17
export ANDROID_HOME=/path/to/android/sdk
export NDK_HOME=$ANDROID_HOME/ndk/27.0.12077973
```

### Initialize Android project (first time only)

```bash
yarn tauri android init
```

### Build debug APK

```bash
yarn tauri android build --debug --apk --target aarch64
```

The APK is output to:

```
src-tauri/gen/android/app/build/outputs/apk/
```

Install on a connected device:

```bash
adb install src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

### Run on device/emulator (dev mode)

```bash
yarn tauri android dev
```

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).
