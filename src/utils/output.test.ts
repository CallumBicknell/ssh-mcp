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
});
