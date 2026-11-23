import { describe, expect, it } from "vitest";
import { speakable, speechPieces } from "@/lib/speakable";

describe("speakable", () => {
  it("drops code, links, citations and source lists", () => {
    const md = [
      "## Summary",
      "Transformers use **attention** [1] and are fast [2](https://a.dev). See [the paper](https://arxiv.org/abs/1706.03762).",
      "```python\nprint('hi')\n```",
      "- Item one",
      "- Item `two`",
      "",
      "Sources:",
      "[1] [Attention](https://arxiv.org/abs/1706.03762)",
      "[2] [Blog](https://a.dev)",
    ].join("\n");
    expect(speakable(md)).toBe(
      "Summary. Transformers use attention and are fast. See the paper. Item one. Item two.",
    );
  });

  it("reads table rows as lists", () => {
    expect(speakable("| a | b |\n|---|---|\n| 1 | 2 |")).toBe("a, b. 1, 2.");
  });
});

describe("speechPieces", () => {
  it("packs sentences up to the limit", () => {
    const text = "One two three. Four five six. Seven eight nine.";
    expect(speechPieces(text, 30)).toEqual(["One two three. Four five six.", "Seven eight nine."]);
  });

  it("cuts a sentence longer than the limit at a space", () => {
    const pieces = speechPieces("word ".repeat(100).trim() + ".", 50);
    expect(pieces.every((p) => p.length <= 50)).toBe(true);
    expect(pieces.join(" ").split(" ").length).toBe(100);
  });
});
