import { describe, expect, it } from "vitest";
import { accessModeOf, canPublishPaid, selectReadEvents } from "./access";

describe("accessModeOf", () => {
  it("returns the explicit mode when set", () => {
    expect(accessModeOf({ access_mode: "free" })).toBe("free");
    expect(accessModeOf({ access_mode: "paid" })).toBe("paid");
  });

  it("defaults a null/legacy value to paid, never free", () => {
    // A zero-priced legacy import must stay paid (an unpriced draft), so a
    // missing access_mode must not read as free.
    expect(accessModeOf({ access_mode: null })).toBe("paid");
  });
});

describe("canPublishPaid", () => {
  it("requires both a positive price and a verified wallet", () => {
    expect(canPublishPaid("1000", true)).toBe(true);
    expect(canPublishPaid("0", true)).toBe(false);
    expect(canPublishPaid("1000", false)).toBe(false);
    expect(canPublishPaid("0", false)).toBe(false);
  });
});

describe("selectReadEvents", () => {
  const payments = [
    { article_id: "a", sequence: 0 },
    { article_id: "a", sequence: 1 },
    { article_id: "b", sequence: 0 },
  ];
  const deliveries = [
    { article_id: "a", sequence: 0 },
    { article_id: "a", sequence: 1 },
    { article_id: "a", sequence: 2 },
  ];

  it("reads a paid article from the payment ledger", () => {
    const reads = selectReadEvents({ id: "a", access_mode: "paid" }, payments, deliveries);
    expect(reads).toHaveLength(2);
    expect(reads).toEqual(payments.slice(0, 2));
  });

  it("reads a free article from the delivery ledger", () => {
    // Free articles have no payments, so readership comes from deliveries.
    const reads = selectReadEvents({ id: "a", access_mode: "free" }, [], deliveries);
    expect(reads).toHaveLength(3);
    expect(reads).toEqual(deliveries);
  });

  it("scopes events to the requested article", () => {
    const reads = selectReadEvents({ id: "b", access_mode: "paid" }, payments, deliveries);
    expect(reads).toEqual([{ article_id: "b", sequence: 0 }]);
  });

  it("treats a legacy (null) mode as paid for read selection", () => {
    const reads = selectReadEvents({ id: "a", access_mode: null }, payments, deliveries);
    expect(reads).toEqual(payments.slice(0, 2));
  });
});
