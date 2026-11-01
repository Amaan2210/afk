/**
 * Turns off modes an agent's TUI may have left on. Each one is harmless to turn off when it is
 * already off:
 * - default colours;
 * - cursor shown;
 * - normal cursor keys and keypad;
 * - line wrap on;
 * - insert mode off;
 * - mouse, focus and bracketed-paste reporting off.
 */
const MODES_OFF =
  "\x1b[0m\x1b[?25h\x1b[?1l\x1b>\x1b[?7h\x1b[4l" +
  "\x1b[?9l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1004l\x1b[?2004l";

// Alternate-screen switches: 1049 saves and restores the cursor, 1047 and 47 do not.
// eslint-disable-next-line no-control-regex -- matching an escape sequence is the point
const ALT_SCREEN = /\x1b\[\?(1049|1047|47)([hl])/g;
/** Long enough to hold all but the last byte of the longest switch, `ESC [ ? 1049 h`. */
const CARRY = 7;

/**
 * Follows the session's output to know how to hand the terminal back to the user's shell. The
 * alternate screen is left only if the output entered it. Leaving it when not in it restores a
 * cursor that was never saved, which moves the cursor to the top of the window.
 */
export class TerminalReset {
  private altMode: string | undefined;
  /** The end of the output so far, so a switch split across chunks is still seen. */
  private carry = "";

  observe(chunk: Buffer): void {
    // latin1 maps each byte to one character, so a UTF-8 sequence split across chunks is harmless.
    const text = this.carry + chunk.toString("latin1");
    for (const [, mode, set] of text.matchAll(ALT_SCREEN)) {
      this.altMode = set === "h" ? mode : undefined;
    }
    this.carry = text.slice(-CARRY);
  }

  /** What to write so the terminal is as the user's shell expects it. */
  sequence(): string {
    const leaveAlt = this.altMode === undefined ? "" : `\x1b[?${this.altMode}l`;
    return leaveAlt + MODES_OFF;
  }
}
