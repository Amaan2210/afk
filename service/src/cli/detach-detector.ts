/** Two keys pressed one after the other: a control byte, then a plain key. */
export interface DetachChord {
  first: number;
  second: string;
}

/** `Ctrl+]` then `d`. */
export const DEFAULT_CHORD: DetachChord = { first: 0x1d, second: "d" };

/**
 * Watches keystrokes for the detach chord. Everything else is forwarded as it came. The chord's
 * first byte is held back until the next byte shows whether the chord follows: if it does, neither
 * byte is forwarded; otherwise both are. Bytes after a completed chord in the same chunk are
 * dropped, since the caller is detaching.
 */
export class DetachDetector {
  private readonly first: number;
  private readonly second: number;
  private pending = false;

  constructor(chord: DetachChord = DEFAULT_CHORD) {
    const second = Buffer.from(chord.second, "utf8");
    if (second.length !== 1) throw new Error("The detach chord's second key must be one byte.");
    this.first = chord.first;
    this.second = second[0] as number;
  }

  feed(bytes: Buffer): { forward: Buffer; detach: boolean } {
    // Typing and pasting rarely involve the chord: pass those chunks through as they are.
    if (!this.pending && !bytes.includes(this.first)) return { forward: bytes, detach: false };
    const out: number[] = [];
    for (const byte of bytes) {
      if (this.pending) {
        this.pending = false;
        if (byte === this.second) return { forward: Buffer.from(out), detach: true };
        out.push(this.first, byte);
      } else if (byte === this.first) {
        this.pending = true;
      } else {
        out.push(byte);
      }
    }
    return { forward: Buffer.from(out), detach: false };
  }
}
