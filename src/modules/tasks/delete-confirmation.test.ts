import { describe, expect, it } from "vitest";
import {
  createDeleteConfirmationToken,
  verifyDeleteConfirmationToken,
} from "./delete-confirmation";

describe("delete confirmation tokens", () => {
  it("accepts a valid token for the expected task", () => {
    const token = createDeleteConfirmationToken("12");
    expect(verifyDeleteConfirmationToken(token, "12")).toEqual({
      valid: true,
    });
  });

  it("rejects tokens for a different task", () => {
    const token = createDeleteConfirmationToken("12");
    const result = verifyDeleteConfirmationToken(token, "13");
    expect(result.valid).toBe(false);
  });

  it("rejects tampered tokens", () => {
    const token = createDeleteConfirmationToken("12");
    const tampered = `${token.slice(0, -2)}aa`;
    const result = verifyDeleteConfirmationToken(tampered, "12");
    expect(result.valid).toBe(false);
  });
});
