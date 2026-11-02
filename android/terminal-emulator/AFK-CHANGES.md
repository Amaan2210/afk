# AFK changes to terminal-emulator

Copied from [termux/termux-app](https://github.com/termux/termux-app) tag `v0.118.3`, directory
`terminal-emulator/`, under the Apache License 2.0 (see `LICENSE` and `NOTICE`). AFK feeds the
emulator from the daemon's WebSocket instead of a local process, so the native pty code is gone.

## Added

- `LICENSE` (the Apache License 2.0), `NOTICE`, this file and `build.gradle.kts`.

## Removed

- `src/main/jni/` (`Android.mk`, `termux.c`): the native pty library.
- `build.gradle`: replaced by `build.gradle.kts` (AGP 9 library, Java 17 instead of 1.8, minSdk 26,
  no targetSdk) without the NDK version, `externalNativeBuild` and `ndk.abiFilters`, `maven-publish`
  and the `sourceJar` task, the release `proguardFiles`, `testOptions.unitTests.returnDefaultValues`,
  the JUnit test dependency and the test logging settings.
- `proguard-rules.pro`: it held only the Android Studio template's comments.
- `src/test/`: upstream's JUnit tests, which need `returnDefaultValues`; AFK tests the emulator
  through its own `TerminalBridgeTest`.

## Edited

- `src/main/java/com/termux/terminal/JNI.java`: replaced by a stub with the same class and method
  signatures (no longer `native`) and no `System.loadLibrary("termux")`; every method throws
  `UnsupportedOperationException("AFK feeds the terminal from the daemon; no local pty")`.
- `src/main/java/com/termux/terminal/TerminalSession.java`: the class is no longer `final`, and
  the `mEmulator` field is `protected` instead of package-private, so AFK's `AfkTerminalSession`
  can extend it and set the emulator it builds.
- `src/main/AndroidManifest.xml`: removed `package="com.termux.terminal"`, which AGP 8 and later
  reject; the namespace is set in `build.gradle.kts`.

Every other file under `src/main/java/` is unchanged.
