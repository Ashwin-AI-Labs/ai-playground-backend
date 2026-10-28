import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./auth.password";
import { hashToken, createRefreshTokenValue } from "./auth.tokens";
import {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  resendOtpSchema,
  updateNameSchema,
} from "./auth.schemas";

// ─── Password hashing ─────────────────────────────────────────────────────────

describe("hashPassword / verifyPassword", () => {
  it("hashes and verifies a valid password", async () => {
    const hash = await hashPassword("MyPassword1");
    expect(typeof hash).toBe("string");
    expect(hash).not.toBe("MyPassword1");

    const valid = await verifyPassword(hash, "MyPassword1");
    expect(valid).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("CorrectHorse99");
    const valid = await verifyPassword(hash, "WrongPassword0");
    expect(valid).toBe(false);
  });

  it("produces different hashes for the same password (salted)", async () => {
    const hash1 = await hashPassword("SamePassword1");
    const hash2 = await hashPassword("SamePassword1");
    expect(hash1).not.toBe(hash2);
  });
});

// ─── Token utilities ──────────────────────────────────────────────────────────

describe("hashToken", () => {
  it("produces a deterministic sha256 hex string", () => {
    const token = "abc123";
    const hash1 = hashToken(token);
    const hash2 = hashToken(token);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(hash1)).toBe(true);
  });

  it("produces different hashes for different tokens", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});

describe("createRefreshTokenValue", () => {
  it("returns a 64-char hex string", () => {
    const token = createRefreshTokenValue();
    expect(token).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(token)).toBe(true);
  });

  it("returns a unique value on each call", () => {
    const t1 = createRefreshTokenValue();
    const t2 = createRefreshTokenValue();
    expect(t1).not.toBe(t2);
  });
});

// ─── Schema validation ────────────────────────────────────────────────────────

describe("registerSchema", () => {
  it("accepts a valid registration payload", () => {
    const result = registerSchema.safeParse({
      name: "Alice",
      email: "alice@example.com",
      password: "password1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a password without a digit", () => {
    const result = registerSchema.safeParse({
      name: "Alice",
      email: "alice@example.com",
      password: "onlyletters",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a password without a letter", () => {
    const result = registerSchema.safeParse({
      name: "Alice",
      email: "alice@example.com",
      password: "12345678",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a password shorter than 8 chars", () => {
    const result = registerSchema.safeParse({
      name: "Alice",
      email: "alice@example.com",
      password: "abc1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid email", () => {
    const result = registerSchema.safeParse({
      name: "Alice",
      email: "not-an-email",
      password: "validPass1",
    });
    expect(result.success).toBe(false);
  });

  it("normalises email to lowercase", () => {
    const result = registerSchema.safeParse({
      name: "Alice",
      email: "ALICE@EXAMPLE.COM",
      password: "validPass1",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("alice@example.com");
    }
  });

  it("accepts optional gender enum values", () => {
    for (const gender of ["female", "male", "non_binary", "prefer_not_to_say", "other"] as const) {
      const result = registerSchema.safeParse({
        name: "Test",
        email: "test@example.com",
        password: "validPass1",
        gender,
      });
      expect(result.success, `expected success for gender=${gender}`).toBe(true);
    }
  });
});

describe("loginSchema", () => {
  it("accepts valid credentials", () => {
    const result = loginSchema.safeParse({
      email: "user@example.com",
      password: "anypassword",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing password", () => {
    const result = loginSchema.safeParse({
      email: "user@example.com",
    });
    expect(result.success).toBe(false);
  });
});

describe("verifyEmailSchema", () => {
  it("accepts a 6-digit OTP", () => {
    const result = verifyEmailSchema.safeParse({
      email: "user@example.com",
      otp: "123456",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an OTP with fewer than 6 digits", () => {
    const result = verifyEmailSchema.safeParse({
      email: "user@example.com",
      otp: "12345",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-numeric OTP", () => {
    const result = verifyEmailSchema.safeParse({
      email: "user@example.com",
      otp: "abcdef",
    });
    expect(result.success).toBe(false);
  });
});

describe("resendOtpSchema", () => {
  it("accepts a valid email", () => {
    const result = resendOtpSchema.safeParse({ email: "user@example.com" });
    expect(result.success).toBe(true);
  });
});

describe("updateNameSchema", () => {
  it("accepts a valid name", () => {
    const result = updateNameSchema.safeParse({ name: "Alice" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = updateNameSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a name over 120 characters", () => {
    const result = updateNameSchema.safeParse({ name: "a".repeat(121) });
    expect(result.success).toBe(false);
  });
});
