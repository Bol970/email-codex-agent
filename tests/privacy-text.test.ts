import { describe, expect, it } from "vitest";
import { splitEmailText } from "../src/App";

describe("splitEmailText", () => {
  it("marks a single email address inside prose", () => {
    expect(splitEmailText("Reply to alex@example.com today")).toEqual([
      { text: "Reply to ", isEmail: false },
      { text: "alex@example.com", isEmail: true },
      { text: " today", isEmail: false }
    ]);
  });

  it("marks multiple email addresses", () => {
    expect(splitEmailText("from a@example.com to b.test+ops@example.org")).toEqual([
      { text: "from ", isEmail: false },
      { text: "a@example.com", isEmail: true },
      { text: " to ", isEmail: false },
      { text: "b.test+ops@example.org", isEmail: true }
    ]);
  });

  it("keeps non-email text as one public segment", () => {
    expect(splitEmailText("No address here")).toEqual([{ text: "No address here", isEmail: false }]);
  });
});
