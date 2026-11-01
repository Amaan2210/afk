/** ConPTY's request for win32-input-mode, `ESC [ ? 9001 h`. */
const REQUEST = Buffer.from("\x1b[?9001h", "latin1");

/**
 * Keeps a session's win32-input-mode request out of the attached window.
 *
 * A session's pseudoconsole sends this request to the terminal hosting it, which is the daemon's
 * node-pty, when it starts. If the request reached the attached window, that window's console
 * would encode every key as a win32-input sequence, and the detach chord would never arrive as
 * its plain byte. The session's pseudoconsole reads plain keys as well, so dropping the request
 * loses nothing.
 *
 * A chunk can end with the first bytes of a request. Those bytes are held back until the next
 * chunk shows whether a request follows.
 */
export class Win32InputFilter {
  private held = Buffer.alloc(0);

  filter(chunk: Buffer): Buffer {
    let data = this.held.length > 0 ? Buffer.concat([this.held, chunk]) : chunk;
    this.held = Buffer.alloc(0);
    if (!data.includes(0x1b)) return data;
    for (let at = data.indexOf(REQUEST); at !== -1; at = data.indexOf(REQUEST, at)) {
      data = Buffer.concat([data.subarray(0, at), data.subarray(at + REQUEST.length)]);
    }
    const partial = partialRequestAtEnd(data);
    if (partial === 0) return data;
    this.held = Buffer.from(data.subarray(data.length - partial));
    return data.subarray(0, data.length - partial);
  }
}

/** How many bytes at the end of `data` could be the start of a request. */
function partialRequestAtEnd(data: Buffer): number {
  for (let n = Math.min(REQUEST.length - 1, data.length); n > 0; n--) {
    if (data.subarray(data.length - n).equals(REQUEST.subarray(0, n))) return n;
  }
  return 0;
}
