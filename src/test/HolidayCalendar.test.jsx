import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HolidayCalendar, {
  clearHolidayCache,
  createPtoHacks,
  createPtoWindows,
  distanceLabel,
  isoDate,
  normalizeHoliday,
  parseQuery,
  resolveCountry,
} from "../frontend/HolidayCalendar";

const fixedNow = new Date(2026, 11, 15, 12);

function searchData(query, code = "GB", name = "United Kingdom") {
  return {
    entities: [
      {
        word: name,
        entityInfo: {
          hdLabel: name,
          geo: { country: name, countryCode: code },
        },
      },
    ],
    query,
    _processedQuery: query.toLowerCase(),
  };
}

function response(items) {
  return Promise.resolve({ ok: true, status: 200, json: async () => items });
}

const christmas = {
  date: "2026-12-25",
  name: "Christmas Day",
  countryCode: "GB",
  nationalHoliday: true,
  subdivisionCodes: null,
  holidayTypes: ["Public", "Bank"],
};

beforeEach(() => {
  clearHolidayCache();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("local query parsing", () => {
  it("parses explicit years and yearly mode", () => {
    const result = parseQuery(searchData("Holidays in USA 2028"), fixedNow);
    expect(result).toMatchObject({ year: 2028, month: null, exactDate: null, mode: "year" });
  });

  it("parses this year and next year", () => {
    expect(parseQuery(searchData("Public holidays in UK this year"), fixedNow).year).toBe(2026);
    expect(parseQuery(searchData("Public holidays in UK next year"), fixedNow).year).toBe(2027);
  });

  it("rolls next month into the following year", () => {
    expect(parseQuery(searchData("Holidays in the US next month"), fixedNow)).toMatchObject({
      year: 2027,
      month: 1,
      mode: "month",
    });
  });

  it("parses full and abbreviated month names", () => {
    expect(parseQuery(searchData("Holidays in Japan July 2026"), fixedNow).month).toBe(7);
    expect(parseQuery(searchData("Holidays in Japan Sept 2026"), fixedNow).month).toBe(9);
  });

  it("parses month-first and day-first exact dates", () => {
    expect(parseQuery(searchData("Is July 4 a holiday in USA 2026"), fixedNow)).toMatchObject({
      exactDate: "2026-07-04",
      mode: "exact",
    });
    expect(parseQuery(searchData("Is 25th of December a holiday in UK 2026"), fixedNow).exactDate)
      .toBe("2026-12-25");
  });

  it("resolves Diwali by name only from the verified 2026 calendar", () => {
    expect(parseQuery(searchData("Is Diwali a holiday in India 2026"), fixedNow)).toMatchObject({
      exactDate: "2026-11-08",
      month: 11,
      mode: "exact",
    });
    expect(parseQuery(searchData("Is Diwali a holiday in India 2027"), fixedNow)).toMatchObject({
      exactDate: null,
      mode: "year",
    });
  });

  it("rejects impossible dates without rolling into another month", () => {
    expect(isoDate(2026, 2, 30)).toBeNull();
    expect(isoDate(2028, 2, 29)).toBe("2028-02-29");
  });
});

describe("country and API field normalization", () => {
  it("supports every documented country-code path", () => {
    expect(resolveCountry({ entities: [{ entityInfo: { countryCode: "in", hdLabel: "India" } }] })).toEqual({ code: "IN", name: "India" });
    expect(resolveCountry({ entities: [{ countryCode: "ca", word: "Canada" }] })).toEqual({ code: "CA", name: "Canada" });
    expect(resolveCountry({ entities: [{ entityInfo: { geo: { countryCode: "gb", country: "United Kingdom" } } }] })).toEqual({ code: "GB", name: "United Kingdom" });
  });

  it("falls back safely to the United States", () => {
    expect(resolveCountry({ entities: [] })).toEqual({ code: "US", name: "United States" });
    expect(resolveCountry({ entities: [{ countryCode: "invalid" }] }).code).toBe("US");
  });

  it("normalizes both v4 and legacy holiday field names", () => {
    expect(normalizeHoliday(christmas)).toMatchObject({ nationalHoliday: true, holidayTypes: ["Public", "Bank"] });
    expect(normalizeHoliday({ date: "2026-01-01", localName: "New Year", global: true, types: ["Public"] }))
      .toMatchObject({ name: "New Year", nationalHoliday: true, holidayTypes: ["Public"] });
  });
});

describe("PTO optimization", () => {
  const opportunities = [
    { date: "2026-01-02", name: "Friday Holiday" },
    { date: "2026-01-05", name: "Monday Holiday" },
    { date: "2026-01-06", name: "Tuesday Holiday" },
    { date: "2026-01-07", name: "Wednesday Holiday" },
    { date: "2026-01-08", name: "Thursday Holiday" },
  ];

  it("detects long weekends, bridge days, Wednesday goldmines, and weekend pairs", () => {
    const hacks = createPtoHacks(opportunities);
    expect(hacks.filter((hack) => hack.kind.includes("3-Day Long Weekend"))).toHaveLength(2);
    expect(hacks.filter((hack) => hack.kind === "1 PTO → 4 Days Off")).toHaveLength(2);
    expect(hacks.some((hack) => hack.detail.includes("Take 2 PTO days to get 9 consecutive days off!"))).toBe(true);
    expect(hacks.some((hack) => hack.title === "Friday Holiday + Monday Holiday")).toBe(true);
  });

  it("finds the longest holiday-anchored break for a PTO budget", () => {
    const windows = createPtoWindows(
      [{ date: "2026-01-02", name: "Friday Holiday" }],
      2026,
      1,
    );

    expect(windows[0]).toMatchObject({
      start: "2026-01-01",
      end: "2026-01-04",
      totalDays: 4,
      ptoUsed: 1,
      holidayNames: ["Friday Holiday"],
      ptoDates: ["2026-01-01"],
    });
  });

  it("discovers a zero-PTO streak when holidays surround a weekend", () => {
    const windows = createPtoWindows([
      { date: "2026-01-02", name: "Friday Holiday" },
      { date: "2026-01-05", name: "Monday Holiday" },
    ], 2026, 0);

    expect(windows[0]).toMatchObject({
      start: "2026-01-02",
      end: "2026-01-05",
      totalDays: 4,
      ptoUsed: 0,
    });
  });

  it("formats date distance deterministically", () => {
    expect(distanceLabel("2026-12-15", fixedNow)).toBe("Today");
    expect(distanceLabel("2026-12-16", fixedNow)).toBe("Tomorrow");
    expect(distanceLabel("2026-12-20", fixedNow)).toBe("In 5 days");
    expect(distanceLabel("2026-12-14", fixedNow)).toBe("Passed");
  });
});

describe("rendered query modes", () => {
  it("renders an exact-date YES banner, types, and loaded notification", async () => {
    const componentLoaded = vi.fn();
    vi.stubGlobal("fetch", vi.fn(() => response([christmas])));
    render(<HolidayCalendar searchData={searchData("Is December 25 a holiday in UK 2026")} messageHandlers={{ componentLoaded }} />);

    expect(screen.getByRole("status")).toHaveTextContent("Finding public holidays");
    expect(await screen.findByText("YES")).toBeInTheDocument();
    expect(screen.getAllByText("Christmas Day").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Public").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bank").length).toBeGreaterThan(0);
    await waitFor(() => expect(componentLoaded).toHaveBeenCalledTimes(1));
  });

  it("renders an exact-date NO banner and the next same-year holiday", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response([
      { ...christmas, date: "2026-07-12", name: "Battle of the Boyne" },
    ])));
    const { container } = render(<HolidayCalendar searchData={searchData("Is June 16 a holiday in UK 2026")} />);

    expect(await screen.findByText("Not a public holiday")).toBeInTheDocument();
    expect(container.querySelector(".hd-next")).toHaveTextContent("Battle of the Boyne");
  });

  it("continues the next-holiday lookup into the following year", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response([christmas]))
      .mockImplementationOnce(() => response([{ ...christmas, date: "2027-01-01", name: "New Year's Day" }]));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<HolidayCalendar searchData={searchData("Is December 31 a holiday in UK 2026")} />);

    await waitFor(() => expect(container.querySelector(".hd-next")).toHaveTextContent("New Year's Day"));
    expect(container.querySelector(".hd-next")).toHaveTextContent("Jan 1, 2027");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("filters month queries client-side and shows the required empty state", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response([christmas])));
    render(<HolidayCalendar searchData={searchData("Holidays in UK October 2026")} />);

    expect(await screen.findByText("No public holidays found for October 2026 in United Kingdom"))
      .toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "https://date.nager.at/api/v4/Holidays/GB/2026",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("treats a 204 response as a valid empty calendar", async () => {
    const json = vi.fn();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 204, json })));
    render(<HolidayCalendar searchData={searchData("Holidays in Canada 2026", "CA", "Canada")} />);

    expect(await screen.findByText("No public holidays found for 2026 in Canada")).toBeInTheDocument();
    expect(json).not.toHaveBeenCalled();
  });

  it("uses the verified Republic Day fallback when Nager returns 204 for India", async () => {
    const json = vi.fn();
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 204, json }));
    vi.stubGlobal("fetch", fetchMock);
    render(<HolidayCalendar searchData={searchData("Is January 26 a holiday in India 2026", "IN", "India")} />);

    expect(await screen.findByText("YES")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Republic Day" })).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByText("Official India fallback", { exact: false })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://date.nager.at/api/v4/Holidays/IN/2026",
      expect.objectContaining({ method: "GET" }),
    );
    expect(json).not.toHaveBeenCalled();
  });

  it("renders the complete India Post all-India fallback after Nager returns 204", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 204, json: vi.fn() })));
    render(<HolidayCalendar searchData={searchData("Holidays in India 2026", "IN", "India")} />);

    expect(await screen.findByRole("button", { name: "Calendar 14" })).toBeInTheDocument();
    expect(screen.getByText("Independence Day")).toBeInTheDocument();
    expect(screen.getByText("Diwali (Deepavali)")).toBeInTheDocument();
    expect(screen.getByText("Christmas Day")).toBeInTheDocument();
  });

  it("answers YES for Diwali from the official India fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 204, json: vi.fn() })));
    render(<HolidayCalendar searchData={searchData("Is November 8 a holiday in India 2026", "IN", "India")} />);

    expect(await screen.findByText("YES")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Diwali (Deepavali)" })).toBeInTheDocument();
    expect(screen.getByText("Sunday, November 8, 2026")).toBeInTheDocument();
  });

  it("answers YES when Diwali is requested by name for 2026", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 204, json: vi.fn() })));
    render(<HolidayCalendar searchData={searchData("Is Diwali a holiday in India 2026", "IN", "India")} />);

    expect(await screen.findByText("YES")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Diwali (Deepavali)" })).toBeInTheDocument();
    expect(screen.getByText("Sunday, November 8, 2026")).toBeInTheDocument();
  });

  it("generates fixed Indian national holidays for future years", async () => {
    const json = vi.fn();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 204, json })));
    render(<HolidayCalendar searchData={searchData("Is January 26 a holiday in India 2027", "IN", "India")} />);

    expect(await screen.findByText("YES")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Republic Day" })).toBeInTheDocument();
    expect(screen.getByText("Tuesday, January 26, 2027")).toBeInTheDocument();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByText("Official India fallback", { exact: false })).not.toBeInTheDocument();
    expect(json).not.toHaveBeenCalled();
  });

  it("returns NO for a nonmatch in the complete India 2026 calendar", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 204, json: vi.fn() })));
    render(<HolidayCalendar searchData={searchData("Is January 27 a holiday in India 2026", "IN", "India")} />);

    expect(await screen.findByText("NO")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Not a public holiday" })).toBeInTheDocument();
    expect(screen.getByText("verified all-India public holiday calendar", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("LIMITED COVERAGE")).not.toBeInTheDocument();
  });

  it("keeps limited coverage for unverified India dates outside 2026", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, status: 204, json: vi.fn() })));
    render(<HolidayCalendar searchData={searchData("Is January 27 a holiday in India 2027", "IN", "India")} />);

    expect(await screen.findByText("LIMITED COVERAGE")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "This date needs regional verification" })).toBeInTheDocument();
    expect(screen.getByText("Check the relevant state or employer calendar", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("Not a public holiday")).not.toBeInTheDocument();
  });

  it("groups yearly results by month and displays regional subdivisions", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response([
      { ...christmas, date: "2026-01-01", name: "Regional New Year", nationalHoliday: false, subdivisionCodes: ["GB-ENG"] },
      christmas,
    ])));
    render(<HolidayCalendar searchData={searchData("Holidays in UK 2026")} />);

    expect(await screen.findByRole("heading", { name: "January 2026" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "December 2026" })).toBeInTheDocument();
    expect(screen.getByText("Regional: GB-ENG")).toBeInTheDocument();
  });

  it("lets users switch from a query month to the full-year explorer", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response([
      { ...christmas, date: "2026-01-01", name: "New Year's Day" },
      christmas,
    ])));
    render(<HolidayCalendar searchData={searchData("Holidays in UK December 2026")} />);

    expect(await screen.findByRole("heading", { name: "December holidays" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "all" } });
    expect(screen.getByRole("heading", { name: "2026 calendar" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "January 2026" })).toBeInTheDocument();
  });

  it("lets users override the country resolved from searchData", async () => {
    const fetchMock = vi.fn((url) => response([
      { ...christmas, countryCode: url.includes("/CA/") ? "CA" : "GB" },
    ]));
    vi.stubGlobal("fetch", fetchMock);
    render(<HolidayCalendar searchData={searchData("Holidays in UK 2026")} />);

    expect(await screen.findByRole("heading", { name: "2026 calendar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Country" })).toHaveTextContent("United Kingdom");
    fireEvent.click(screen.getByRole("button", { name: "Country" }));
    fireEvent.click(screen.getByRole("option", { name: "Canada" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Canada" })).toBeInTheDocument());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "https://date.nager.at/api/v4/Holidays/CA/2026",
      expect.objectContaining({ method: "GET" }),
    ));
  });

  it("loads Nager.Date's supported-country list when the picker is opened", async () => {
    const fetchMock = vi.fn((url) => url.endsWith("/Countries/Available")
      ? response([
        { countryCode: "AT", name: "Austria" },
        { countryCode: "GB", name: "United Kingdom" },
      ])
      : response([christmas]));
    vi.stubGlobal("fetch", fetchMock);
    render(<HolidayCalendar searchData={searchData("Holidays in UK 2026")} />);

    await screen.findByRole("heading", { name: "2026 calendar" });
    fireEvent.click(screen.getByRole("button", { name: "Country" }));

    expect(await screen.findByRole("option", { name: "Austria" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://date.nager.at/api/v4/Countries/Available",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("copies a ranked PTO Time Machine plan without rendering the old hacks card", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.stubGlobal("fetch", vi.fn(() => response([christmas])));
    render(<HolidayCalendar searchData={searchData("Holidays in UK 2026")} />);

    await screen.findByRole("heading", { name: "2026 calendar" });
    fireEvent.click(screen.getByRole("button", { name: "PTO Time Machine" }));
    expect(screen.queryByRole("heading", { name: "Smart PTO & Vacation Hacks" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy PTO window 1" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Christmas Day")));
  });

  it("runs the interactive PTO Time Machine when the leave budget changes", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response([christmas])));
    render(<HolidayCalendar searchData={searchData("Holidays in UK 2026")} />);

    await screen.findByRole("heading", { name: "2026 calendar" });
    fireEvent.click(screen.getByRole("button", { name: "PTO Time Machine" }));

    expect(screen.getByRole("heading", { name: "PTO Time Machine" })).toBeInTheDocument();
    expect(screen.getByText("2 PTO → 5 days off")).toBeInTheDocument();
    expect(screen.getByLabelText(/Friday, December 25: Christmas Day/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "1", exact: true }));
    expect(screen.getByText("1 PTO → 4 days off")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps exact-date results focused until the user opens the calendar", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response([christmas])));
    render(<HolidayCalendar searchData={searchData("Is December 25 a holiday in UK 2026")} />);

    expect(await screen.findByText("YES")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "December holidays" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Explore December holidays" }));
    expect(screen.getByRole("heading", { name: "December holidays" })).toBeInTheDocument();
  });

  it("lets users choose a date and refetches when the selected year changes", async () => {
    const fetchMock = vi.fn((url) => url.includes("/2027")
      ? response([{ ...christmas, date: "2027-12-25" }])
      : response([]));
    vi.stubGlobal("fetch", fetchMock);
    render(<HolidayCalendar searchData={searchData("Holidays in UK 2026")} />);

    await screen.findByRole("heading", { name: "2026 calendar" });
    fireEvent.change(screen.getByLabelText("Check date"), { target: { value: "2027-12-25" } });

    expect(await screen.findByText("YES")).toBeInTheDocument();
    expect(screen.getByLabelText("Check date")).toHaveValue("2027-12-25");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://date.nager.at/api/v4/Holidays/GB/2027",
      expect.objectContaining({ method: "GET" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(await screen.findByRole("heading", { name: "2026 calendar" })).toBeInTheDocument();
  });

  it("lets users choose a day from the themed calendar popover", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response([christmas])));
    render(<HolidayCalendar searchData={searchData("Is December 25 a holiday in UK 2026")} />);

    await screen.findByText("YES");
    fireEvent.click(screen.getByRole("button", { name: "Open calendar" }));
    expect(screen.getByRole("dialog", { name: "Choose a date" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose December 26, 2026" }));

    expect(await screen.findByText("Not a public holiday")).toBeInTheDocument();
    expect(screen.getByLabelText("Check date")).toHaveValue("2026-12-26");
    expect(document.querySelector('input[type="date"]')).not.toBeInTheDocument();
  });

  it("switches between Christmas and Diwali gradient themes", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response([christmas])));
    const { container } = render(<HolidayCalendar searchData={searchData("Holidays in UK 2026")} />);

    await screen.findByRole("heading", { name: "2026 calendar" });
    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(screen.queryByText("Festival of lights edition")).not.toBeInTheDocument();
    expect(screen.queryByText("Christmas edition")).not.toBeInTheDocument();
    expect(container.querySelector(".hd-calendar")).toHaveClass("theme-diwali");
    expect(screen.getByRole("button", { name: "Diwali" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Christmas" }));
    expect(container.querySelector(".hd-calendar")).toHaveClass("theme-christmas");
  });

  it("renders an API error and retries successfully", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockImplementationOnce(() => response([christmas]));
    vi.stubGlobal("fetch", fetchMock);
    render(<HolidayCalendar searchData={searchData("Holidays in UK 2026")} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Network unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "2026 calendar" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
