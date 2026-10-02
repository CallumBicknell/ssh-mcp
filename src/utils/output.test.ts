import { describe, expect, it } from "vitest";
import { capOutput, OutputCapper } from "./output.js";

describe("capOutput", () => {
  it("returns short input unchanged", () => {
    expect(capOutput("hello", 100)).toEqual({ text: "hello", truncated: false, bytes: 5 });
  });

  it("truncates by byte length", () => {
    const out = capOutput("abcdef", 3);
    expect(out.text).toBe("abc");
    expect(out.truncated).toBe(true);
  });

  it("does not split multi-byte characters", () => {
    const input = "ééé"; // 2 bytes each in UTF-8
    const out = capOutput(input, 3);
    expect(out.truncated).toBe(true);
    expect(out.text).toBe("é");
  });

  it("handles output exactly at the limit without truncation", () => {
    const out = capOutput("abcde", 5);
    expect(out).toEqual({ text: "abcde", truncated: false, bytes: 5 });
  });

  it("handles output one byte over the limit", () => {
    const out = capOutput("abcdef", 5);
    expect(out.text).toBe("abcde");
    expect(out.truncated).toBe(true);
  });

  it("never emits U+FFFD when cutting emoji", () => {
    const out = capOutput("😀😀😀", 5); // 4 bytes each in UTF-8
    expect(out.text).toBe("😀");
    expect(out.text).not.toContain("�");
  });
});

describe("OutputCapper", () => {
  it("keeps everything under the limit", () => {
    const capper = new OutputCapper(100);
    capper.push("abc");
    capper.push(Buffer.from("def"));
    expect(capper.result()).toEqual({ text: "abcdef", truncated: false, bytes: 6 });
  });

  it("discards input beyond the limit and flags truncation", () => {
    const capper = new OutputCapper(5);
    capper.push("abc");
    capper.push("defgh");
    capper.push("more");
    expect(capper.result().text).toBe("abcde");
    expect(capper.result().truncated).toBe(true);
  });

  it("does not emit U+FFFD when a multibyte character straddles the limit", () => {
    const capper = new OutputCapper(5);
    capper.push("😀😀"); // 8 bytes, cap at 5 lands mid-second emoji
    const out = capper.result();
    expect(out.text).toBe("😀");
    expect(out.text).not.toContain("�");
    expect(out.truncated).toBe(true);
  });
});
