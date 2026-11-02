package com.termux.terminal;

/**
 * AFK stub of Termux's native pseudoterminal methods (upstream: jni/termux.c, loaded with
 * System.loadLibrary("termux")). AFK feeds the terminal from the daemon's socket and never
 * starts a local process, so no native library is built and every method throws.
 */
final class JNI {

    private static final String NO_PTY = "AFK feeds the terminal from the daemon; no local pty";

    public static int createSubprocess(String cmd, String cwd, String[] args, String[] envVars, int[] processId, int rows, int columns, int cellWidth, int cellHeight) {
        throw new UnsupportedOperationException(NO_PTY);
    }

    public static void setPtyWindowSize(int fd, int rows, int cols, int cellWidth, int cellHeight) {
        throw new UnsupportedOperationException(NO_PTY);
    }

    public static int waitFor(int processId) {
        throw new UnsupportedOperationException(NO_PTY);
    }

    public static void close(int fileDescriptor) {
        throw new UnsupportedOperationException(NO_PTY);
    }

}
