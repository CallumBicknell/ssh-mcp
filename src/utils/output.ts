export interface CappedOutput {
  text: string;
  truncated: boolean;
  bytes: number;
}

/**
 * Trims a buffer down to the largest prefix that contains only complete
 * UTF-8 sequences, so a cut never produces replacement characters.
 */
function cleanUtf8Prefix(buf: Buffer): Buffer {
  let end = buf.length;
  // Skip trailing continuation bytes to find the start of the final sequence.
  while (end > 0 && (buf[end - 1]! & 0xc0) === 0x80) {
    end--;
  }
  if (end > 0) {
    const lead = buf[end - 1]!;
    const seqLen = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
    const present = buf.length - (end - 1);
    if (present < seqLen) {
      end--;
    }
  }
  return buf.subarray(0, end);
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
  const clean = cleanUtf8Prefix(buf.subarray(0, maxBytes));
  return { text: clean.toString("utf8"), truncated: true, bytes: clean.byteLength };
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
    const buf = Buffer.concat(this.chunks);
    const clean = this.truncated ? cleanUtf8Prefix(buf) : buf;
    return {
      text: clean.toString("utf8"),
      truncated: this.truncated,
      bytes: clean.byteLength,
    };
  }
}
