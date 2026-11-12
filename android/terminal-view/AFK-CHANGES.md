# AFK changes to terminal-view

Copied from [termux/termux-app](https://github.com/termux/termux-app) tag `v0.118.3`, directory
`terminal-view/`, under the Apache License 2.0 (see `LICENSE` and `NOTICE`).

## Added

- `LICENSE` (the Apache License 2.0), `NOTICE`, this file and `build.gradle.kts`.

## Removed

- `build.gradle`: replaced by `build.gradle.kts` (AGP 9 library, Java 17 instead of 1.8, minSdk 26,
  no targetSdk) that still depends on `:terminal-emulator` (as `api`) and `androidx.annotation`, now
  at the app catalog's 1.10.0 instead of 1.3.0. Dropped: `maven-publish` and the `sourceJar` task,
  the release `proguardFiles`, the `testInstrumentationRunner` and the JUnit test dependency (the
  module has no tests).
- `proguard-rules.pro`: it held only the Android Studio template's comments.

## Edited

The edited file carries an `AFK:` comment saying what changed.

- `src/main/AndroidManifest.xml`: removed `package="com.termux.view"`, which AGP 8 and later
  reject; the namespace is set in `build.gradle.kts`.

- `src/main/java/com/termux/view/TerminalView.java`, `doScroll`: a swipe on the alternate screen
  no longer sends Up and Down keys. An agent takes Up as "recall the last prompt".

Every other file under `src/main/java/` and `src/main/res/` is unchanged.
