import { describe, expect, it } from "vitest";
import { isNumericId, toApiId } from "./id";

describe("numeric ID helpers", () => {
  it("accepts decimal string IDs", () => {
    expect(isNumericId("1")).toBe(true);
    expect(isNumericId("42")).toBe(true);
    expect(isNumericId("0001")).toBe(true);
    expect(isNumericId("not-a-number")).toBe(false);
  });

  it("serializes bigint and safe numbers as decimal strings", () => {
    expect(toApiId(1)).toBe("1");
    expect(toApiId("15")).toBe("15");
    expect(toApiId(15n)).toBe("15");
  });

  it("rejects unsafe JavaScript numbers", () => {
    expect(() => toApiId(Number.MAX_SAFE_INTEGER + 2)).toThrow(/Unsafe numeric ID/);
  });
});
