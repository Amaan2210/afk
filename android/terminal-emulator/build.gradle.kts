// Termux's terminal emulator (termux/termux-app v0.118.3, Apache-2.0), built as plain Java: AFK
// feeds it from the daemon's socket, so the native pty library is not built. See AFK-CHANGES.md.
plugins {
    alias(libs.plugins.android.library)
}

android {
    namespace = "com.termux.terminal"
    compileSdk = 37

    defaultConfig {
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
