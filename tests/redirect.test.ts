import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/redirect";
import { validSignature } from "@/lib/webhook";

describe("safeNextPath", () => {
  it("keeps same-origin rooted paths", () => {
    expect(safeNextPath("/cases")).toBe("/cases");
  });
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "evil", "/a\nb", "", null, undefined])(
    "rejects %s",
    (v) => expect(safeNextPath(v as string | null)).toBe("/dashboard"),
  );
});

describe("validSignature", () => {
  it("accepts the exact secret", () => expect(validSignature("abcdefgh", "abcdefgh")).toBe(true));
  it("rejects wrong, missing and different-length values", () => {
    expect(validSignature("abcdefgx", "abcdefgh")).toBe(false);
    expect(validSignature(null, "abcdefgh")).toBe(false);
    expect(validSignature("abc", "abcdefgh")).toBe(false);
  });
});
