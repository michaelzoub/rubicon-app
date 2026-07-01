import { describe, expect, it } from "vitest";
import {
  formatUsdc,
  isValidAddress,
  parseUsdcAmount,
  validateDestination,
  validateWithdrawAmount,
} from "./gateway";

const ONE_USDC = 1_000_000n; // 6 decimals

describe("parseUsdcAmount", () => {
  it("parses whole and fractional amounts to atomic units", () => {
    expect(parseUsdcAmount("1")).toBe(ONE_USDC);
    expect(parseUsdcAmount("1.5")).toBe(1_500_000n);
    expect(parseUsdcAmount("0.000001")).toBe(1n);
    expect(parseUsdcAmount("12.345678")).toBe(12_345_678n);
  });

  it("rejects empty, non-numeric, and zero amounts", () => {
    expect(parseUsdcAmount("")).toEqual({ error: expect.any(String) });
    expect(parseUsdcAmount("abc")).toEqual({ error: expect.any(String) });
    expect(parseUsdcAmount(".")).toEqual({ error: expect.any(String) });
    expect(parseUsdcAmount("0")).toEqual({ error: expect.any(String) });
  });

  it("rejects more than 6 decimal places", () => {
    expect(parseUsdcAmount("1.1234567")).toEqual({ error: expect.any(String) });
  });
});

describe("validateWithdrawAmount", () => {
  const available = 10n * ONE_USDC; // 10 USDC

  it("accepts an amount at or below the balance", () => {
    expect(validateWithdrawAmount("10", available)).toBeNull();
    expect(validateWithdrawAmount("9.999999", available)).toBeNull();
  });

  it("rejects an amount greater than the balance", () => {
    expect(validateWithdrawAmount("10.000001", available)).toMatch(/exceeds/i);
    expect(validateWithdrawAmount("11", available)).toMatch(/exceeds/i);
  });

  it("rejects too many decimals before checking the balance", () => {
    expect(validateWithdrawAmount("1.1234567", available)).toMatch(/decimal/i);
  });

  it("rejects a zero amount", () => {
    expect(validateWithdrawAmount("0", available)).toMatch(/greater than zero/i);
  });
});

describe("address validation", () => {
  it("accepts a well-formed 0x address", () => {
    expect(isValidAddress("0x0077777d7EBA4688BDeF3E311b846F25870A19B9")).toBe(true);
    expect(validateDestination("0x0077777d7EBA4688BDeF3E311b846F25870A19B9")).toBeNull();
  });

  it("rejects malformed addresses", () => {
    expect(isValidAddress("0x123")).toBe(false); // too short
    expect(isValidAddress("0077777d7EBA4688BDeF3E311b846F25870A19B9")).toBe(false); // no 0x
    expect(isValidAddress("0xZZZZ777d7EBA4688BDeF3E311b846F25870A19B9")).toBe(false); // non-hex
    expect(validateDestination("")).toMatch(/destination/i);
    expect(validateDestination("nope")).toMatch(/valid/i);
  });
});

describe("formatUsdc", () => {
  it("renders atomic units as trimmed decimals", () => {
    expect(formatUsdc(ONE_USDC)).toBe("1");
    expect(formatUsdc(1_500_000n)).toBe("1.5");
    expect(formatUsdc(1n)).toBe("0.000001");
    expect(formatUsdc(0n)).toBe("0");
  });
});
