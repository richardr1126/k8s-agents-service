import { describe, expect, it } from "vitest";
import { linkCitations } from "./citations";

const sources = "\n\nSources\n1. [A](https://a.dev/x)\n2. [B](https://b.dev)\n";

describe("linkCitations", () => {
  it("links bare and grouped numbers to the sources list", () => {
    expect(linkCitations(`K3s is small [1, 2].${sources}`)).toContain("[1](https://a.dev/x)[2](https://b.dev).");
    expect(linkCitations(`Yes [2]${sources}`)).toContain("Yes [2](https://b.dev)");
  });

  it("reads inline sources and leaves their labels alone", () => {
    const text = "Fast [1].\n\n**Sources** [1] [K3s guide](https://k.dev) [2] [Other](https://o.dev)";
    const out = linkCitations(text);
    expect(out).toContain("Fast [1](https://k.dev).");
    expect(out).toContain("[1] [K3s guide](https://k.dev)");
  });

  it("leaves unknown numbers, links and text without sources alone", () => {
    expect(linkCitations("Array [0] here")).toBe("Array [0] here");
    expect(linkCitations(`See [3].${sources}`)).toContain("See [3].");
    expect(linkCitations(`Done [1](https://x.dev)${sources}`)).toContain("Done [1](https://x.dev)");
  });
});
