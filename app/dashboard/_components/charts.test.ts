import { describe, expect, it } from "vitest";
import { buildEarningsDonutSlices } from "./chart-data";

const article = (label: string, value: number) => ({ label, value });

describe("buildEarningsDonutSlices", () => {
  it("shows the real titles when one to five earning articles fit", () => {
    expect(buildEarningsDonutSlices([article("Only article", 12)])).toMatchObject([
      { label: "Only article", value: 12 },
    ]);

    const five = buildEarningsDonutSlices([
      article("One", 5),
      article("Two", 4),
      article("Three", 3),
      article("Four", 2),
      article("Five with a deliberately long article title", 1),
    ]);
    expect(five.map((slice) => slice.label)).toEqual([
      "One",
      "Two",
      "Three",
      "Four",
      "Five with a deliberately long article title",
    ]);
    expect(five.some((slice) => slice.label.includes("more"))).toBe(false);
  });

  it("never creates a one-more bucket", () => {
    const six = buildEarningsDonutSlices([
      article("One", 6),
      article("Two", 5),
      article("Three", 4),
      article("Four", 3),
      article("Five", 2),
      article("Six", 1),
    ]);

    expect(six.map((slice) => slice.label)).toEqual(["One", "Two", "Three", "Four", "2 more articles"]);
    expect(six.at(-1)).toMatchObject({
      value: 3,
      groupedLabels: ["Five", "Six"],
    });
    expect(six.some((slice) => slice.label === "1 more" || slice.label === "1 more article")).toBe(false);
  });

  it("filters zero earnings and remains stable for dominant and equal shares", () => {
    const slices = buildEarningsDonutSlices([
      article("Zero", 0),
      article("Dominant", 100),
      article("Equal A", 5),
      article("Equal B", 5),
    ]);

    expect(slices.map((slice) => slice.label)).toEqual(["Dominant", "Equal A", "Equal B"]);
    expect(slices.every((slice) => Boolean(slice.color))).toBe(true);
  });

  it("aggregates many articles into a titled remainder with real contents", () => {
    const slices = buildEarningsDonutSlices(
      Array.from({ length: 12 }, (_, index) => article(`Article ${index + 1}`, 12 - index)),
    );

    expect(slices).toHaveLength(5);
    expect(slices.at(-1)?.label).toBe("8 more articles");
    expect(slices.at(-1)?.groupedLabels).toHaveLength(8);
  });
});
