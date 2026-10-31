/** Fixed-capacity byte ring that keeps the most recent `capacity` bytes pushed into it. */
export class RingBuffer {
  private readonly bytes: Buffer;
  /** Index of the oldest byte held. */
  private start = 0;
  private held = 0;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError(`RingBuffer capacity must be a positive integer, got ${capacity}`);
    }
    this.bytes = Buffer.allocUnsafe(capacity);
  }

  /** Bytes currently held, at most the capacity. */
  get length(): number {
    return this.held;
  }

  push(chunk: Buffer): void {
    const capacity = this.bytes.length;
    const tail = chunk.length > capacity ? chunk.subarray(chunk.length - capacity) : chunk;
    const end = (this.start + this.held) % capacity;
    const untilWrap = Math.min(tail.length, capacity - end);
    tail.copy(this.bytes, end, 0, untilWrap);
    tail.copy(this.bytes, 0, untilWrap);
    const total = this.held + tail.length;
    if (total > capacity) this.start = (this.start + total - capacity) % capacity;
    this.held = Math.min(total, capacity);
  }

  /** A fresh copy of the bytes held, oldest first. */
  toBuffer(): Buffer {
    const out = Buffer.allocUnsafe(this.held);
    const untilWrap = Math.min(this.held, this.bytes.length - this.start);
    this.bytes.copy(out, 0, this.start, this.start + untilWrap);
    this.bytes.copy(out, untilWrap, 0, this.held - untilWrap);
    return out;
  }
}
