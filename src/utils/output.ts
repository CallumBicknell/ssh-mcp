export interface CappedOutput {
  text: string;
  truncated: boolean;
  bytes: number;
}

/**
 * Caps a string to at most `maxBytes` of UTF-8 data. When truncated, the text
 * is cut on a valid UTF-8 boundary near the byte limit.
 */
export function capOutput(input: string, maxBytes: number): CappedOutput {
  const buf = Buffer.from(input, "utf8");
  if (buf.byteLength <= maxBytes) {
    return { text: input, truncated: false, bytes: buf.byteLength };
  }
  let end = maxBytes;
  // Back off while we would split a multi-byte UTF-8 sequence.
  while (end > 0 && (buf[end]! & 0b1100_0000) === 0b1000_0000) {
    end--;
  }
  return { text: buf.subarray(0, end).toString("utf8"), truncated: true, bytes: end };
}

/** Incremental capper that discards input beyond the limit while streaming. */
export class OutputCapper {
  private chunks: Buffer[] = [];
  private total = 0;
  truncated = false;

  constructor(private readonly maxBytes: number) {}

  push(data: Buffer | string): void {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    if (this.total >= this.maxBytes) {
      this.truncated = true;
      return;
    }
    if (this.total + buf.byteLength > this.maxBytes) {
      this.chunks.push(buf.subarray(0, this.maxBytes - this.total));
      this.total = this.maxBytes;
      this.truncated = true;
      return;
    }
    this.chunks.push(buf);
    this.total += buf.byteLength;
  }

  result(): CappedOutput {
    return {
      text: Buffer.concat(this.chunks).toString("utf8"),
      truncated: this.truncated,
      bytes: this.total,
    };
  }
}
