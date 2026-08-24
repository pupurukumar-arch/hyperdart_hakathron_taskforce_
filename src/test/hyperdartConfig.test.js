import { describe, expect, it } from "vitest";
import config from "../../hyperdart.config";

describe("HyperDart trigger configuration", () => {
  it("contains every documented holiday keyword", () => {
    expect(config.triggers.keywords).toEqual(expect.arrayContaining([
      "holiday",
      "holidays",
      "public holiday",
      "public holidays",
    ]));
  });

  it.each([
    "holidays in HD_LOCATION 2026",
    "public holidays of HD_LOCATION 2026",
    "is july 4 a holiday in HD_LOCATION 2026",
    "show holidays in HD_LOCATION next month",
    "list of holidays in HD_LOCATION for july",
    "is december 25 a holiday in HD_LOCATION__CITIES 2026",
    "is december 25 a holiday in the HD_LOCATION__CITIES",
    "holidays in the HD_LOCATION next month",
  ])("matches documented query shape: %s", (query) => {
    expect(config.query_format.regex.some((pattern) => new RegExp(pattern, "i").test(query))).toBe(true);
  });
});
