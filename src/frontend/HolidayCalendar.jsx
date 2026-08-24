import React, { useEffect, useMemo, useRef, useState } from "react";
import diwaliShadowBackdrop from "./assets/diwali-shadow-backdrop.webp";
import christmasShadowBackdrop from "./assets/christmas-shadow-backdrop.webp";

const API_ROOT = "https://date.nager.at/api/v4";
const API_BASE = `${API_ROOT}/Holidays`;
const COUNTRIES_API = `${API_ROOT}/Countries/Available`;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const holidayCache = new Map();
const dateFormatterCache = new Map();
let supportedCountriesCache = null;
let supportedCountriesRequest = null;

// Nager.Date currently returns 204 for India and omits IN from its supported
// country list. This official all-India fallback is sourced from India Post's
// 2026 holiday calendar; state and regional observances can still differ.
const INDIA_POST_SOURCE = {
  countryCode: "IN",
  nationalHoliday: true,
  subdivisionCodes: null,
  holidayTypes: ["Public"],
  verifiedFallback: true,
  yearSpecificFallback: true,
  sourceName: "India Post — All India Holidays 2026",
  sourceUrl: "https://www.indiapost.gov.in/holidays-list",
};

const INDIA_FIXED_NATIONAL_HOLIDAYS = [
  ["01-26", "Republic Day"],
  ["08-15", "Independence Day"],
  ["10-02", "Mahatma Gandhi's Birthday"],
];

const INDIA_FIXED_SOURCE = {
  countryCode: "IN",
  nationalHoliday: true,
  subdivisionCodes: null,
  holidayTypes: ["Public"],
  verifiedFallback: true,
  fixedIndiaFallback: true,
  sourceName: "Government of India — Incredible India Public Holidays",
  sourceUrl: "https://www.incredibleindia.gov.in/en/plan-your-trip/public-holidays",
};

const VERIFIED_HOLIDAY_FALLBACKS = {
  "IN-2026": [
    ["2026-01-26", "Republic Day"],
    ["2026-03-21", "Id-ul-Fitr"],
    ["2026-03-31", "Mahavir Jayanti"],
    ["2026-04-03", "Good Friday"],
    ["2026-05-01", "Buddha Purnima"],
    ["2026-05-27", "Id-ul-Zuha"],
    ["2026-06-26", "Muharram"],
    ["2026-08-15", "Independence Day"],
    ["2026-08-26", "Prophet Mohammad's Birthday (Id-e-Milad)"],
    ["2026-10-02", "Mahatma Gandhi's Birthday"],
    ["2026-10-20", "Dussehra (Vijay Dashmi)"],
    ["2026-11-08", "Diwali (Deepavali)"],
    ["2026-11-24", "Guru Nanak's Birthday"],
    ["2026-12-25", "Christmas Day"],
  ].map(([date, name]) => ({ ...INDIA_POST_SOURCE, date, name })),
};

// Movable holidays are resolved by name only when a year-specific official
// calendar supplies the date. Do not turn these into repeating annual dates.
const VERIFIED_NAMED_HOLIDAY_DATES = {
  2026: [
    { pattern: /\b(?:diwali|deepavali)\b/i, month: 11, day: 8 },
  ],
};

const KNOWN_UNSUPPORTED_NAGER_COUNTRIES = new Set(["IN"]);

function getVerifiedHolidayFallback(countryCode, year) {
  const yearSpecific = (VERIFIED_HOLIDAY_FALLBACKS[`${countryCode}-${year}`] || [])
    .map((holiday) => ({ ...holiday }));
  if (countryCode !== "IN" || !Number.isInteger(Number(year))) return yearSpecific;

  const fixedNational = INDIA_FIXED_NATIONAL_HOLIDAYS.map(([monthDay, name]) => ({
    ...INDIA_FIXED_SOURCE,
    date: `${year}-${monthDay}`,
    name,
  }));
  const byDateAndName = new Map();
  [...yearSpecific, ...fixedNational].forEach((holiday) => {
    const key = `${holiday.date}-${holiday.name}`;
    if (!byDateAndName.has(key)) byDateAndName.set(key, holiday);
  });
  return [...byDateAndName.values()].sort((first, second) => first.date.localeCompare(second.date));
}

const MONTHS = [
  ["january", "jan"],
  ["february", "feb"],
  ["march", "mar"],
  ["april", "apr"],
  ["may", "may"],
  ["june", "jun"],
  ["july", "jul"],
  ["august", "aug"],
  ["september", "sep", "sept"],
  ["october", "oct"],
  ["november", "nov"],
  ["december", "dec"],
];

const MONTH_LOOKUP = MONTHS.reduce((lookup, names, index) => {
  names.forEach((name) => {
    lookup[name] = index + 1;
  });
  return lookup;
}, {});

const MONTH_PATTERN = Object.keys(MONTH_LOOKUP)
  .sort((a, b) => b.length - a.length)
  .join("|");

// Offline fallback containing the countries named in the case study. The
// complete supported list is loaded from Nager.Date when the picker is used.
const COUNTRY_OPTIONS = [
  { code: "AU", name: "Australia" },
  { code: "BR", name: "Brazil" },
  { code: "CA", name: "Canada" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "IN", name: "India" },
  { code: "IT", name: "Italy" },
  { code: "JP", name: "Japan" },
  { code: "MX", name: "Mexico" },
  { code: "NL", name: "Netherlands" },
  { code: "SG", name: "Singapore" },
  { code: "ES", name: "Spain" },
  { code: "CH", name: "Switzerland" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
];

const styles = `
  .hd-calendar, .hd-calendar * { box-sizing: border-box; }
  .hd-calendar {
    --ink: #16211d; --muted: #66736d; --line: #dfe7e2; --paper: #ffffff;
    --green: #0c7a52; --green-soft: #e8f7f0; --red: #b33a36; --red-soft: #fff0ef;
    width: 100%; color: var(--ink); background: #f4f7f5; border: 1px solid var(--line);
    border-radius: 24px; overflow: hidden; font-family: Inter, ui-sans-serif, system-ui, -apple-system,
    BlinkMacSystemFont, "Segoe UI", sans-serif; box-shadow: 0 18px 50px rgba(26, 55, 43, .09);
  }
  .hd-hero { padding: 28px; color: white; background: radial-gradient(circle at 90% 15%, #36a477 0, transparent 32%), linear-gradient(135deg, #173d30, #0b6c4c); }
  .hd-hero-row, .hd-row { display: flex; align-items: center; }
  .hd-hero-row { justify-content: space-between; gap: 18px; }
  .hd-identity { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .hd-flag { display: grid; place-items: center; width: 54px; height: 54px; flex: 0 0 54px; border-radius: 16px; background: rgba(255,255,255,.14); font-size: 30px; }
  .hd-kicker { margin: 0 0 5px; color: #bcebd7; font-size: 11px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
  .hd-title { margin: 0; color: #fff; font-size: clamp(22px, 4vw, 32px); line-height: 1.12; letter-spacing: -.025em; }
  .hd-query-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; margin-top: 9px; }
  .hd-country-control, .hd-date-control { display: flex; align-items: center; gap: 7px; }
  .hd-country-control label, .hd-date-control label { color: rgba(255,255,255,.72); font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .hd-country-select { min-width: 150px; padding: 6px 27px 6px 9px; border: 1px solid rgba(255,255,255,.25); border-radius: 8px; color: #fff; background: rgba(0,0,0,.16); font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; }
  .hd-country-select option { color: #17201d; background: #fff; }
  .hd-country-select:focus { outline: 3px solid rgba(255,255,255,.16); border-color: rgba(255,255,255,.62); }
  .hd-country-count { color: rgba(255,255,255,.55); font-size: 9px; font-weight: 650; white-space: nowrap; }
  .hd-date-input { min-width: 132px; padding: 6px 8px; border: 1px solid rgba(255,255,255,.25); border-radius: 8px; color: #fff; color-scheme: dark; background: rgba(0,0,0,.16); font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; }
  .hd-date-input:focus { outline: 3px solid rgba(255,255,255,.16); border-color: rgba(255,255,255,.62); }
  .hd-date-reset { padding: 5px 7px; border: 1px solid rgba(255,255,255,.22); border-radius: 7px; color: rgba(255,255,255,.78); background: transparent; font: inherit; font-size: 9px; font-weight: 750; cursor: pointer; }
  .hd-date-reset:hover { color: #fff; background: rgba(255,255,255,.10); }
  .hd-resolved { flex: 0 0 auto; padding: 9px 13px; border: 1px solid rgba(255,255,255,.27); border-radius: 999px; background: rgba(255,255,255,.12); font-size: 13px; font-weight: 750; }
  .hd-main { padding: 22px; }
  .hd-card { margin-bottom: 18px; padding: 20px; border: 1px solid var(--line); border-radius: 18px; background: var(--paper); }
  .hd-answer { display: flex; align-items: flex-start; gap: 15px; border-width: 1px 1px 1px 5px; }
  .hd-answer.yes { border-left-color: var(--green); background: linear-gradient(100deg, var(--green-soft), #fff 65%); }
  .hd-answer.no { border-left-color: var(--red); background: linear-gradient(100deg, var(--red-soft), #fff 65%); }
  .hd-answer.unknown { border-left-color: #b7770d; background: linear-gradient(100deg, #fff7df, #fff 65%); }
  .hd-answer-badge { flex: 0 0 auto; padding: 8px 10px; border-radius: 10px; color: white; font-size: 12px; font-weight: 900; letter-spacing: .08em; }
  .hd-answer.yes .hd-answer-badge { background: var(--green); }
  .hd-answer.no .hd-answer-badge { background: var(--red); }
  .hd-answer.unknown .hd-answer-badge { color: #4f3300; background: #f3bd4b; }
  .hd-answer h2, .hd-section-title { margin: 0; letter-spacing: -.015em; }
  .hd-answer h2 { font-size: 20px; }
  .hd-answer p { margin: 5px 0 0; color: var(--muted); font-size: 14px; }
  .hd-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
  .hd-section-title { font-size: 18px; }
  .hd-count { color: var(--muted); font-size: 12px; font-weight: 700; }
  .hd-hacks { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 11px; }
  .hd-hack { position: relative; padding: 15px; border: 1px solid #e4d9b8; border-radius: 15px; background: #fffbec; }
  .hd-hack-kind { display: inline-block; margin-bottom: 7px; color: #88640d; font-size: 11px; font-weight: 850; letter-spacing: .05em; text-transform: uppercase; }
  .hd-hack strong { display: block; padding-right: 28px; font-size: 14px; line-height: 1.35; }
  .hd-hack p { margin: 5px 0 0; color: #705f38; font-size: 12px; line-height: 1.45; }
  .hd-copy { position: absolute; top: 10px; right: 10px; width: 30px; height: 30px; border: 0; border-radius: 9px; color: #725c20; background: #f5e9bb; cursor: pointer; font-size: 14px; }
  .hd-copy:hover { background: #ead68e; }
  .hd-month + .hd-month { margin-top: 20px; }
  .hd-month-label { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; color: #486058; font-size: 13px; font-weight: 850; letter-spacing: .08em; text-transform: uppercase; }
  .hd-month-label::after { content: ""; height: 1px; flex: 1; background: var(--line); }
  .hd-list { display: grid; gap: 10px; }
  .hd-holiday { display: grid; grid-template-columns: minmax(132px, .34fr) 1fr auto; gap: 16px; align-items: center; padding: 15px; border: 1px solid var(--line); border-radius: 15px; background: #fff; transition: transform .16s ease, box-shadow .16s ease; }
  .hd-holiday:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(29, 65, 50, .08); }
  .hd-date-pill { padding: 9px 11px; border-radius: 11px; color: #13583f; background: #eaf5f0; font-size: 12px; font-weight: 800; line-height: 1.35; }
  .hd-date-pill span { display: block; color: #668078; font-size: 11px; font-weight: 650; }
  .hd-holiday-name { margin: 0 0 6px; font-size: 15px; }
  .hd-tags { display: flex; flex-wrap: wrap; gap: 5px; }
  .hd-tag { padding: 3px 7px; border-radius: 999px; color: #53655f; background: #f0f4f2; font-size: 10px; font-weight: 750; }
  .hd-tag.national { color: #075e41; background: #dff4ea; }
  .hd-tag.regional { color: #71461f; background: #f5ead7; }
  .hd-distance { color: var(--muted); font-size: 11px; font-weight: 750; white-space: nowrap; }
  .hd-state { display: grid; place-items: center; min-height: 260px; padding: 32px; text-align: center; }
  .hd-spinner { width: 34px; height: 34px; margin-bottom: 14px; border: 3px solid #cfe0d8; border-top-color: var(--green); border-radius: 50%; animation: hd-spin .8s linear infinite; }
  .hd-state h2 { margin: 0 0 6px; font-size: 19px; }
  .hd-state p { max-width: 470px; margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; }
  .hd-retry { margin-top: 16px; padding: 10px 15px; border: 0; border-radius: 11px; color: white; background: var(--green); font-weight: 800; cursor: pointer; }
  .hd-empty { padding: 26px; border: 1px dashed #cbd7d1; border-radius: 15px; color: var(--muted); background: #fafcfb; text-align: center; }
  .hd-source-note { margin: 0 0 14px; padding: 12px 14px; border: 1px solid #e8cf96; border-radius: 12px; color: #5e4717; background: #fff9e9; font-size: 12px; line-height: 1.5; }
  .hd-source-note strong { color: #3f2e08; }
  .hd-source-note a { color: inherit; font-weight: 800; text-underline-offset: 2px; }
  .hd-next { margin-top: 12px !important; padding-top: 11px; border-top: 1px solid #ecd9d7; color: var(--ink) !important; }
  @keyframes hd-spin { to { transform: rotate(360deg); } }
  @media (max-width: 650px) {
    .hd-hero, .hd-main { padding: 20px; }
    .hd-hero-row { align-items: flex-start; flex-direction: column; }
    .hd-holiday { grid-template-columns: 1fr; gap: 10px; }
    .hd-distance { justify-self: start; }
    .hd-answer { flex-direction: column; }
  }
  @media (prefers-reduced-motion: reduce) { .hd-spinner { animation-duration: 1.8s; } .hd-holiday { transition: none; } }

  /* Product-style visual layer: restrained, functional, and easy to scan. */
  .hd-calendar { --ink: #17201d; --muted: #68716d; --line: #e2e4df; --paper: #fff; --green: #176b4d; background: #f6f6f2; border-radius: 16px; box-shadow: 0 8px 30px rgba(29, 35, 32, .07); }
  .hd-hero { padding: 24px; color: var(--ink); background: #fff; border-bottom: 1px solid var(--line); }
  .hd-title { color: var(--ink); font-family: Georgia, "Times New Roman", serif; font-size: clamp(25px, 4vw, 34px); font-weight: 500; }
  .hd-kicker { color: #7b6350; letter-spacing: .11em; }
  .hd-flag { color: #fff; background: #1e2c27; font-size: 15px; font-weight: 850; letter-spacing: .08em; }
  .hd-hero-meta { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
  .hd-resolved { color: #34403b; border-color: var(--line); background: #f6f6f2; }
  .hd-live { display: inline-flex; align-items: center; gap: 6px; color: #52615b; font-size: 11px; font-weight: 750; }
  .hd-live::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #2b966d; box-shadow: 0 0 0 3px #e4f2ec; }
  .hd-main { padding: 18px; }
  .hd-card { padding: 18px; border-radius: 13px; box-shadow: none; }
  .hd-answer { border-radius: 13px; }
  .hd-answer.yes { background: #f5faf7; }
  .hd-answer.no { background: #fff8f7; }
  .hd-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 18px; }
  .hd-stat { padding: 14px; border: 1px solid var(--line); border-radius: 12px; background: #fff; }
  .hd-stat-value { display: block; margin-bottom: 3px; font-family: Georgia, "Times New Roman", serif; font-size: 23px; }
  .hd-stat-label { color: var(--muted); font-size: 10px; font-weight: 750; letter-spacing: .04em; text-transform: uppercase; }
  .hd-section-title { font-family: Georgia, "Times New Roman", serif; font-size: 21px; font-weight: 500; }
  .hd-hacks { grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }
  .hd-hack { border-color: #e7e1d6; background: #fbfaf6; }
  .hd-copy { color: #5c554a; background: #eeeadf; }
  .hd-copy:hover { background: #e2ddcf; }
  .hd-holiday { border-radius: 11px; transition: border-color .15s ease; }
  .hd-holiday:hover { transform: none; border-color: #adb8b2; box-shadow: none; }
  .hd-date-pill { color: #52473c; background: #f1eee7; }
  .hd-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 15px; }
  .hd-filter { display: flex; align-items: center; gap: 8px; }
  .hd-filter label { color: var(--muted); font-size: 11px; font-weight: 750; }
  .hd-select { max-width: 145px; padding: 8px 28px 8px 10px; border: 1px solid #ccd2ce; border-radius: 9px; color: var(--ink); background: #fff; font: inherit; font-size: 12px; cursor: pointer; }
  .hd-more { display: block; width: 100%; margin-top: 12px; padding: 10px; border: 1px solid #d9d6cc; border-radius: 9px; color: #4e4a42; background: #fff; font-size: 12px; font-weight: 750; cursor: pointer; }
  .hd-more:hover { background: #f7f5ef; }
  @media (max-width: 650px) {
    .hd-hero-meta { justify-content: flex-start; }
    .hd-stats { grid-template-columns: 1fr 1fr 1fr; }
    .hd-stat { padding: 11px 8px; }
    .hd-stat-value { font-size: 20px; }
    .hd-toolbar { align-items: flex-start; flex-direction: column; }
  }

  /* Festive edition: classic Christmas colors without novelty UI. */
  .hd-calendar {
    --ink: #19231f; --muted: #6e746f; --line: #dedfd8; --paper: #fffefa;
    --green: #176347; --green-soft: #edf6f1; --red: #a43a3a; --red-soft: #fbefec;
    position: relative; background: #f7f3e9; border-color: #d9d8cf;
  }
  .hd-calendar::before { content: ""; position: absolute; z-index: 2; top: 0; left: 0; right: 0; height: 4px; background: repeating-linear-gradient(90deg, #a63838 0 34px, #f3e4bf 34px 45px, #174d3a 45px 79px, #f3e4bf 79px 90px); }
  .hd-hero {
    position: relative; overflow: hidden; padding-top: 28px; color: #fff;
    background-color: #123c30;
    background-image: radial-gradient(circle at 12% 25%, rgba(255,255,255,.18) 0 1.5px, transparent 2px), radial-gradient(circle at 82% 35%, rgba(255,255,255,.14) 0 1px, transparent 1.5px), linear-gradient(135deg, #11392e, #1c5744);
    background-size: 58px 58px, 41px 41px, auto; border-bottom: 0;
  }
  .hd-hero::after { content: ""; position: absolute; right: -38px; bottom: -65px; width: 180px; height: 180px; border: 1px solid rgba(232,207,153,.18); border-radius: 50%; box-shadow: 0 0 0 22px rgba(232,207,153,.05), 0 0 0 45px rgba(232,207,153,.035); }
  .hd-title { position: relative; z-index: 1; color: #fff; }
  .hd-kicker { color: #e6ca8d; }
  .hd-flag { position: relative; z-index: 1; color: #173b30; background: #f8f0dd; border: 1px solid rgba(255,255,255,.25); }
  .hd-hero-meta { position: relative; z-index: 1; }
  .hd-live { color: #d7e9df; }
  .hd-live::before { background: #9bd0b8; box-shadow: 0 0 0 3px rgba(212,237,225,.16); }
  .hd-resolved { color: #fff; border-color: rgba(255,255,255,.24); background: rgba(255,255,255,.09); }
  .hd-festive { width: 100%; margin-top: 3px; color: #e6ca8d; font-family: Georgia, "Times New Roman", serif; font-size: 12px; font-style: italic; text-align: right; }
  .hd-theme-switcher { display: inline-flex; gap: 3px; padding: 3px; border: 1px solid rgba(255,255,255,.22); border-radius: 999px; background: rgba(0,0,0,.12); }
  .hd-theme-button { padding: 6px 9px; border: 0; border-radius: 999px; color: rgba(255,255,255,.72); background: transparent; font: inherit; font-size: 10px; font-weight: 800; cursor: pointer; }
  .hd-theme-button:hover { color: #fff; }
  .hd-theme-button.active { color: #173b30; background: #f8f0dd; box-shadow: 0 2px 8px rgba(0,0,0,.14); }
  .hd-main { background: linear-gradient(180deg, #f7f3e9 0%, #eef4ef 52%, #f7f3e9 100%); }
  .hd-card, .hd-stat { background: #fffefa; border-color: #dfded5; }
  .hd-answer.yes { border-left-color: #176347; background: #f3f8f4; }
  .hd-answer.no { border-left-color: #a43a3a; background: #fcf4f1; }
  .hd-answer.yes .hd-answer-badge { background: #176347; }
  .hd-answer.no .hd-answer-badge { background: #a43a3a; }
  .hd-stat { position: relative; overflow: hidden; }
  .hd-stat::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: #d6b66e; }
  .hd-stat:nth-child(2)::after { background: #1b674d; }
  .hd-stat:nth-child(3)::after { background: #c8a557; }
  .hd-section-title { color: #173b30; }
  .hd-hack { border-color: #e4dac3; background: #fbf7eb; }
  .hd-hack-kind { color: #875e20; }
  .hd-copy { color: #704b1b; background: #f0e4c7; }
  .hd-copy:hover { background: #e7d5ad; }
  .hd-month-label { color: #285b47; }
  .hd-month-label::after { background: #e2d8cc; }
  .hd-holiday { background: #fffefa; }
  .hd-date-pill { color: #214d3d; background: #edf3ed; border-left: 3px solid #d1ad5d; }
  .hd-tag.national { color: #16533f; background: #e2f0e8; }
  .hd-select:focus { outline: 3px solid rgba(23,99,71,.13); border-color: #176347; }
  .hd-more { color: #174835; border-color: #d7d2c5; background: #fffcf5; }
  @media (max-width: 650px) { .hd-festive { text-align: left; } }

  /* Christmas theme: evergreen, cranberry, snow, and warm candlelight. */
  .theme-christmas .hd-hero {
    background-color: #123c30;
    background-image: radial-gradient(circle at 10% 20%, rgba(255,255,255,.30) 0 1.5px, transparent 2px), radial-gradient(circle at 78% 34%, rgba(255,245,220,.22) 0 1px, transparent 1.5px), linear-gradient(125deg, #0d3529 0%, #176149 62%, #7d2938 125%);
    background-size: 48px 48px, 35px 35px, auto;
  }
  .theme-christmas .hd-hero::after { border-color: rgba(245,216,153,.24); box-shadow: 0 0 0 22px rgba(242,218,166,.08), 0 0 0 45px rgba(255,255,255,.035); }
  .hd-calendar.theme-christmas::before { background: linear-gradient(90deg, #8f183d 0 28%, #f2c58a 28% 35%, #d54464 35% 63%, #f2c58a 63% 70%, #6d1737 70%); }
  .theme-christmas .hd-main { background: linear-gradient(180deg, #fff6f8 0%, #fcebf0 54%, #fff5f0 100%); }
  .theme-christmas .hd-card, .theme-christmas .hd-stat { background: rgba(255,250,251,.98); border-color: #ebced8; }
  .theme-christmas .hd-stat::after { background: #c82f58; }
  .theme-christmas .hd-stat:nth-child(2)::after { background: #8d2145; }
  .theme-christmas .hd-stat:nth-child(3)::after { background: #e17287; }
  .theme-christmas .hd-section-title { color: #7c1e43; }
  .theme-christmas .hd-hack { border-color: #ebc8d3; background: linear-gradient(135deg, #fff8f5, #fce8ee); }
  .theme-christmas .hd-hack-kind { color: #a02a50; }
  .theme-christmas .hd-date-pill { color: #7a2142; background: #fbe6ec; border-left-color: #cf3e62; }
  .theme-christmas .hd-month-label { color: #7c2948; }
  .theme-christmas .hd-live::before { background: #f1a3b5; box-shadow: 0 0 0 3px rgba(242,165,183,.18); }
  .theme-christmas .hd-festive::before { content: "✦ "; color: #f1d087; font-style: normal; }

  /* Diwali theme: midnight indigo, royal violet, saffron, and lamp gold. */
  .hd-calendar.theme-diwali {
    --paper: #fffdf5; --line: #e8d7ad; --green: #5b3aa2; --red: #b4432b;
    background: #fff0bd; border-color: #dfbd73;
  }
  .hd-calendar.theme-diwali::before { background: linear-gradient(90deg, #ffc84f 0 24%, #f07922 24% 48%, #5a36a0 48% 74%, #21114f 74%); }
  .theme-diwali .hd-hero {
    background-color: #55205f;
    background-image: radial-gradient(circle at 12% 24%, rgba(255,223,143,.55) 0 1.5px, transparent 2px), radial-gradient(circle at 84% 34%, rgba(255,235,173,.38) 0 1px, transparent 1.5px), linear-gradient(135deg, #39134f 0%, #8d286d 48%, #e56f2f 100%);
    background-size: 54px 54px, 38px 38px, auto;
  }
  .theme-diwali .hd-hero::after { border-color: rgba(255,214,112,.28); box-shadow: 0 0 0 22px rgba(255,192,74,.10), 0 0 0 45px rgba(255,154,58,.06); }
  .theme-diwali .hd-kicker, .theme-diwali .hd-festive { color: #ffe2a0; }
  .theme-diwali .hd-flag { color: #311c72; background: #fff0b8; }
  .theme-diwali .hd-live { color: #fff0ce; }
  .theme-diwali .hd-live::before { background: #ffd16a; box-shadow: 0 0 0 3px rgba(255,218,128,.18); }
  .theme-diwali .hd-theme-button.active { color: #321b73; background: #ffecaa; }
  .theme-diwali .hd-main { background: linear-gradient(180deg, #f5f0ff 0%, #fff9ea 54%, #fff0d2 100%); }
  .theme-diwali .hd-card, .theme-diwali .hd-stat { background: rgba(255,253,244,.98); border-color: #e7d3a3; }
  .theme-diwali .hd-stat::after { background: #f39b25; }
  .theme-diwali .hd-stat:nth-child(2)::after { background: #5636a0; }
  .theme-diwali .hd-stat:nth-child(3)::after { background: #e96d2d; }
  .theme-diwali .hd-section-title { color: #3b267f; }
  .theme-diwali .hd-hack { border-color: #e9ce91; background: #fff7dc; }
  .theme-diwali .hd-hack-kind { color: #a85b17; }
  .theme-diwali .hd-copy { color: #3d277f; background: #f3dda4; }
  .theme-diwali .hd-month-label { color: #412d84; }
  .theme-diwali .hd-date-pill { color: #3b267c; background: #fff0bd; border-left-color: #f18c21; }
  .theme-diwali .hd-select:focus { outline-color: rgba(73,47,150,.16); border-color: #4d3292; }
  .theme-diwali .hd-more { color: #402b80; border-color: #e6d09d; background: #fff9e4; }

  /* Workspace flow: focused views and compact, progressive disclosure. */
  .hd-calendar { background: #f4f2ed; border-color: #d8d6cf; box-shadow: 0 24px 70px rgba(28,24,20,.12); }
  .hd-hero { padding: 26px 28px 22px; }
  .theme-diwali .hd-hero { background-image: radial-gradient(circle at 86% 16%, rgba(255,196,66,.42), transparent 27%), radial-gradient(circle at 20% 112%, rgba(241,113,30,.30), transparent 42%), linear-gradient(125deg, #160d3d 0%, #392273 54%, #ef7725 122%); background-repeat: no-repeat; background-size: auto, auto, auto; }
  .theme-christmas .hd-hero { background-image: radial-gradient(circle at 87% 16%, rgba(255,196,205,.30), transparent 26%), radial-gradient(circle at 20% 110%, rgba(245,171,140,.20), transparent 40%), linear-gradient(125deg, #351022 0%, #8b2449 58%, #d55269 118%); background-repeat: no-repeat; background-size: auto, auto, auto; }
  .hd-hero-row, .hd-resolution-flow { position: relative; z-index: 2; }
  .hd-hero::before { content: ""; position: absolute; z-index: 1; inset: 0; pointer-events: none; background-position: right bottom; background-repeat: no-repeat; background-size: auto 100%; opacity: .24; filter: saturate(.78) contrast(.92); }
  .theme-diwali .hd-hero::before { background-image: url("${diwaliShadowBackdrop}"); opacity: .42; mix-blend-mode: screen; filter: saturate(1.08) contrast(1.08); }
  .theme-christmas .hd-hero::before { background-image: url("${christmasShadowBackdrop}"); opacity: .31; mix-blend-mode: screen; filter: sepia(.20) saturate(1.15) hue-rotate(292deg) contrast(1.05); }
  .hd-title { font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-weight: 720; letter-spacing: -.04em; }
  .hd-query-controls { margin-top: 7px; }
  .hd-country-select { min-width: 142px; backdrop-filter: blur(8px); }
  .hd-resolution-flow { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; margin: 22px 0 0; padding: 0; overflow: hidden; border: 1px solid rgba(255,255,255,.15); border-radius: 12px; background: rgba(255,255,255,.10); list-style: none; }
  .hd-resolution-step { min-width: 0; padding: 10px 12px; background: rgba(5,5,5,.10); }
  .hd-resolution-step span { display: block; margin-bottom: 3px; color: rgba(255,255,255,.58); font-size: 8px; font-weight: 850; letter-spacing: .12em; text-transform: uppercase; }
  .hd-resolution-step strong { display: block; overflow: hidden; color: #fff; font-size: 11px; font-weight: 720; text-overflow: ellipsis; white-space: nowrap; }
  .hd-main { min-height: 340px; padding: 0 18px 18px; }
  .hd-workspace-nav { display: flex; gap: 4px; margin: 0 -18px 18px; padding: 10px 18px; border-bottom: 1px solid #dedbd4; background: rgba(255,255,255,.76); }
  .hd-workspace-tab { display: inline-flex; align-items: center; gap: 7px; padding: 9px 12px; border: 0; border-radius: 9px; color: #6b6964; background: transparent; font: inherit; font-size: 12px; font-weight: 760; cursor: pointer; }
  .hd-workspace-tab:hover { color: #262521; background: #eeece6; }
  .hd-workspace-tab.active { color: #fff; background: #252421; box-shadow: 0 5px 14px rgba(24,23,21,.15); }
  .theme-diwali .hd-workspace-nav { border-bottom-color: #e6d8bd; background: linear-gradient(90deg, #eee8ff, #fff3d5); }
  .theme-diwali .hd-workspace-tab { color: #5b4b70; }
  .theme-diwali .hd-workspace-tab:hover { color: #34225f; background: rgba(255,255,255,.64); }
  .theme-diwali .hd-workspace-tab.active { color: #382269; background: #ffe7a3; box-shadow: 0 4px 11px rgba(68,45,111,.13); }
  .theme-diwali .hd-tab-count { background: rgba(46,24,103,.14); }
  .theme-christmas .hd-workspace-nav { border-bottom-color: #ecd5dc; background: linear-gradient(90deg, #fdebf0, #fff4f1); }
  .theme-christmas .hd-workspace-tab { color: #76515e; }
  .theme-christmas .hd-workspace-tab:hover { color: #6e1e3f; background: rgba(255,255,255,.68); }
  .theme-christmas .hd-workspace-tab.active { color: #721e40; background: #f8d7e0; box-shadow: 0 4px 11px rgba(112,31,64,.12); }
  .theme-christmas .hd-tab-count { background: rgba(117,28,64,.13); }
  .hd-tab-count { display: grid; min-width: 18px; height: 18px; place-items: center; padding: 0 5px; border-radius: 999px; color: inherit; background: rgba(255,255,255,.18); font-size: 9px; }
  .hd-workspace-panel { animation: hd-panel-in .2s ease-out both; }
  @keyframes hd-panel-in { from { opacity: .35; transform: translateY(4px); } }
  .hd-answer { min-height: 142px; align-items: center; margin-bottom: 12px; padding: 22px; }
  .hd-answer-badge { padding: 10px 12px; border-radius: 8px; }
  .hd-answer h2 { font-size: clamp(20px, 4vw, 26px); }
  .hd-answer-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 20px; }
  .hd-action { padding: 9px 12px; border: 1px solid #cfcbc2; border-radius: 9px; color: #34312d; background: #fff; font: inherit; font-size: 11px; font-weight: 760; cursor: pointer; }
  .hd-action:hover { border-color: #9d978c; background: #faf9f6; }
  .hd-action.primary { color: #fff; border-color: #282622; background: #282622; }
  .theme-diwali .hd-answer, .theme-diwali .hd-calendar-card { border-color: #e3c986; box-shadow: 0 12px 28px rgba(28,13,69,.18); }
  .theme-diwali .hd-answer.yes { background: linear-gradient(135deg, #fffdf7 0%, #fff8e8 58%, #f5f1ff 100%); }
  .theme-diwali .hd-action { color: #4a3478; border-color: #e5d5ad; background: #fffaf0; }
  .theme-diwali .hd-action:hover { border-color: #dfbf73; background: #fff4d9; }
  .theme-diwali .hd-action.primary { color: #3c286b; border-color: #ebcf88; background: #ffedbd; }
  .theme-christmas .hd-answer, .theme-christmas .hd-calendar-card { border-color: #e5b6c4; box-shadow: 0 12px 28px rgba(90,20,50,.17); }
  .theme-christmas .hd-answer.yes { background: linear-gradient(135deg, #fffdfd 0%, #fff3f6 58%, #fff8f4 100%); }
  .theme-christmas .hd-action { color: #7a3550; border-color: #e8cbd4; background: #fffafb; }
  .theme-christmas .hd-action:hover { border-color: #dca9b8; background: #fff0f4; }
  .theme-christmas .hd-action.primary { color: #762442; border-color: #e5bdc9; background: #f8dbe3; }
  .hd-stats { margin-bottom: 12px; }
  .hd-stat { background: rgba(255,255,255,.88); }
  .hd-calendar-card { margin-bottom: 0; }
  details.hd-month { overflow: hidden; border: 1px solid var(--line); border-radius: 11px; background: #fff; }
  details.hd-month + details.hd-month { margin-top: 8px; }
  .hd-month-summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 14px; cursor: pointer; list-style: none; }
  .hd-month-summary::-webkit-details-marker { display: none; }
  .hd-month-summary::after { content: "+"; color: #8a877f; font-size: 18px; font-weight: 400; }
  details[open] > .hd-month-summary::after { content: "−"; }
  .hd-month-label { margin: 0; color: #3c3935; font-size: 12px; }
  .hd-month-label::after { display: none; }
  .hd-section-title { font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-weight: 760; letter-spacing: -.025em; }
  .hd-month-count { margin-left: auto; color: var(--muted); font-size: 10px; font-weight: 700; }
  details.hd-month .hd-list { padding: 0 10px 10px; }
  .hd-time-machine { position: relative; margin-bottom: 14px; padding: 20px; overflow: hidden; border: 1px solid rgba(244,202,108,.22); border-radius: 16px; color: #fff; background: linear-gradient(135deg, #21142c 0%, #4f204c 58%, #8b3d32 125%); box-shadow: 0 16px 34px rgba(43,24,44,.18); }
  .theme-diwali .hd-time-machine { border-color: rgba(255,204,91,.34); background: linear-gradient(135deg, #171044 0%, #43277f 60%, #e16b26 130%); box-shadow: 0 16px 34px rgba(42,25,91,.22); }
  .theme-christmas .hd-time-machine { border-color: rgba(244,184,199,.30); background: linear-gradient(135deg, #351022 0%, #842342 60%, #cf536b 125%); box-shadow: 0 16px 34px rgba(90,24,52,.20); }
  .hd-machine-orbit { position: absolute; top: -86px; right: -54px; width: 210px; height: 210px; border: 1px solid rgba(255,223,148,.16); border-radius: 50%; box-shadow: 0 0 0 25px rgba(255,194,92,.055), 0 0 0 52px rgba(220,93,106,.035); pointer-events: none; }
  .hd-machine-head { position: relative; display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
  .hd-machine-head h2 { margin: 4px 0 5px; color: #fff; font-size: clamp(21px, 4vw, 28px); letter-spacing: -.04em; }
  .hd-machine-head p { max-width: 470px; margin: 0; color: rgba(255,255,255,.68); font-size: 11px; line-height: 1.5; }
  .hd-machine-eyebrow { color: #f5cd77; font-size: 8px; font-weight: 900; letter-spacing: .15em; text-transform: uppercase; }
  .hd-machine-result { flex: 0 0 auto; min-width: 126px; padding: 10px 12px; border: 1px solid rgba(255,255,255,.16); border-radius: 11px; background: rgba(255,255,255,.08); backdrop-filter: blur(8px); }
  .hd-machine-result span { display: block; margin-bottom: 3px; color: rgba(255,255,255,.53); font-size: 8px; font-weight: 850; letter-spacing: .1em; text-transform: uppercase; }
  .hd-machine-result strong { color: #ffe5a4; font-size: 12px; }
  .hd-budget-row { position: relative; display: flex; align-items: center; gap: 8px; margin: 16px 0 14px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,.11); color: rgba(255,255,255,.64); font-size: 9px; font-weight: 750; }
  .hd-budget-options { display: inline-flex; gap: 3px; padding: 3px; border: 1px solid rgba(255,255,255,.13); border-radius: 10px; background: rgba(0,0,0,.16); }
  .hd-budget-options button { display: grid; width: 28px; height: 26px; place-items: center; border: 0; border-radius: 7px; color: rgba(255,255,255,.66); background: transparent; font: inherit; font-size: 10px; font-weight: 850; cursor: pointer; }
  .hd-budget-options button:hover { color: #fff; background: rgba(255,255,255,.09); }
  .hd-budget-options button.active { color: #3d2440; background: #f4ca75; box-shadow: 0 4px 12px rgba(0,0,0,.18); }
  .theme-christmas .hd-budget-options button.active { color: #17372d; background: #e7d198; }
  .hd-window-grid { position: relative; display: grid; gap: 9px; }
  .hd-window-card { padding: 14px; border: 1px solid rgba(255,255,255,.13); border-radius: 12px; background: rgba(255,255,255,.075); backdrop-filter: blur(8px); }
  .hd-window-card.best { border-color: rgba(248,211,126,.42); background: linear-gradient(110deg, rgba(255,217,126,.14), rgba(255,255,255,.07)); }
  .hd-window-topline, .hd-window-title-row, .hd-window-plan { display: flex; justify-content: space-between; gap: 10px; }
  .hd-window-topline { align-items: center; margin-bottom: 9px; color: rgba(255,255,255,.52); font-size: 8px; font-weight: 750; }
  .hd-window-rank { color: #f4ca75; font-weight: 900; letter-spacing: .1em; text-transform: uppercase; }
  .hd-window-title-row { align-items: flex-start; }
  .hd-window-title-row > div { min-width: 0; }
  .hd-window-title-row strong { display: block; color: #fff; font-size: 15px; }
  .hd-window-title-row span { display: block; margin-top: 3px; color: rgba(255,255,255,.62); font-size: 9px; }
  .hd-window-copy { flex: 0 0 auto; padding: 7px 9px; border: 1px solid rgba(255,255,255,.16); border-radius: 8px; color: #f6d88f; background: rgba(0,0,0,.13); font: inherit; font-size: 8px; font-weight: 850; cursor: pointer; }
  .hd-window-copy:hover { color: #fff; background: rgba(255,255,255,.10); }
  .hd-window-strip { display: flex; gap: 4px; margin: 12px 0; padding: 2px 0 5px; overflow-x: auto; scrollbar-color: rgba(255,255,255,.22) transparent; }
  .hd-window-day { display: grid; min-width: 37px; height: 49px; place-items: center; padding: 4px 2px; border: 1px solid rgba(255,255,255,.10); border-radius: 8px; color: rgba(255,255,255,.72); background: rgba(0,0,0,.12); }
  .hd-window-day span { font-size: 7px; font-weight: 800; text-transform: uppercase; }
  .hd-window-day strong { color: #fff; font-size: 12px; line-height: 1; }
  .hd-window-day i { font-size: 7px; font-style: normal; font-weight: 900; }
  .hd-window-day.holiday { color: #3f283e; border-color: #f6d486; background: #f6d486; }
  .hd-window-day.holiday strong { color: #3f283e; }
  .theme-christmas .hd-window-day.holiday { color: #18382e; border-color: #e6d29c; background: #e6d29c; }
  .theme-christmas .hd-window-day.holiday strong { color: #18382e; }
  .hd-window-day.pto { border-color: rgba(235,122,154,.48); background: rgba(205,72,127,.28); }
  .theme-christmas .hd-window-day.pto { border-color: rgba(220,112,122,.45); background: rgba(151,47,63,.34); }
  .hd-window-plan { align-items: flex-start; flex-direction: column; padding-top: 10px; border-top: 1px solid rgba(255,255,255,.09); color: rgba(255,255,255,.66); font-size: 9px; line-height: 1.45; }
  .hd-window-plan span { min-width: 0; overflow-wrap: anywhere; }
  .hd-window-plan b { margin-right: 5px; color: rgba(255,255,255,.93); font-weight: 850; }
  .hd-machine-empty { padding: 20px; border: 1px dashed rgba(255,255,255,.18); border-radius: 11px; color: rgba(255,255,255,.65); background: rgba(0,0,0,.10); font-size: 11px; text-align: center; }
  .hd-machine-legend { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 11px; color: rgba(255,255,255,.48); font-size: 8px; }
  .hd-machine-legend i { display: inline-block; width: 7px; height: 7px; margin-right: 3px; border-radius: 2px; background: rgba(255,255,255,.18); }
  .hd-machine-legend i.holiday { background: #f6d486; }
  .hd-machine-legend i.pto { background: #c94e80; }
  .hd-planner-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 14px; padding: 4px 2px; }
  .hd-planner-head h2 { margin: 0 0 4px; font-size: 20px; letter-spacing: -.025em; }
  .hd-planner-head p { max-width: 520px; margin: 0; color: var(--muted); font-size: 12px; line-height: 1.5; }
  .hd-planner-score { flex: 0 0 auto; padding: 8px 10px; border: 1px solid #ddd7ca; border-radius: 9px; color: #68512b; background: #fffaf0; font-size: 10px; font-weight: 800; }
  .hd-planner-empty { margin: 0; }
  .hd-hero { overflow: visible; padding-top: 60px; }
  .hd-hero::after { display: none; }
  .hd-theme-corner { position: absolute; z-index: 10; top: 14px; right: 16px; display: flex; align-items: center; gap: 7px; }
  .hd-theme-label { color: rgba(255,255,255,.58); font-size: 8px; font-weight: 850; letter-spacing: .12em; text-transform: uppercase; }
  .hd-picker { position: relative; z-index: 8; }
  .hd-picker-label { color: rgba(255,255,255,.72); font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .hd-country-trigger { display: inline-flex; min-width: 142px; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 9px; border: 1px solid rgba(255,255,255,.25); border-radius: 8px; color: #fff; background: rgba(0,0,0,.16); font: inherit; font-size: 11px; font-weight: 700; text-align: left; cursor: pointer; }
  .hd-country-trigger::after { content: "⌄"; color: rgba(255,255,255,.65); font-size: 13px; }
  .hd-country-trigger[aria-expanded="true"]::after { content: "⌃"; }
  .hd-picker-popover { position: absolute; z-index: 30; top: calc(100% + 8px); right: 4px; width: min(300px, calc(100vw - 48px)); overflow: hidden; border: 1px solid rgba(255,218,138,.28); border-radius: 12px; color: #fff; background: #2b1930; box-shadow: 0 18px 50px rgba(12,8,14,.38); }
  .theme-christmas .hd-picker-popover { border-color: rgba(230,207,156,.30); background: #142d27; }
  .hd-country-search-wrap { padding: 10px; border-bottom: 1px solid rgba(255,255,255,.10); }
  .hd-country-search { width: 100%; padding: 9px 10px; border: 1px solid rgba(255,255,255,.16); border-radius: 8px; color: #fff; background: rgba(255,255,255,.08); font: inherit; font-size: 11px; }
  .hd-country-search::placeholder { color: rgba(255,255,255,.48); }
  .hd-country-search:focus { outline: 2px solid #eab55d; border-color: transparent; }
  .theme-christmas .hd-country-search:focus { outline-color: #d9c187; }
  .hd-country-options { max-height: 260px; overflow: auto; padding: 6px; scrollbar-color: rgba(255,255,255,.28) transparent; }
  .hd-country-option { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 9px; border: 0; border-radius: 7px; color: rgba(255,255,255,.82); background: transparent; font: inherit; font-size: 11px; text-align: left; cursor: pointer; }
  .hd-country-option:hover, .hd-country-option[aria-selected="true"] { color: #27172c; background: #f2c56f; }
  .theme-christmas .hd-country-option:hover, .theme-christmas .hd-country-option[aria-selected="true"] { color: #17342b; background: #e7d39e; }
  .hd-country-code { color: inherit; opacity: .65; font-size: 9px; font-weight: 850; letter-spacing: .08em; }
  .hd-country-none { padding: 18px; color: rgba(255,255,255,.58); font-size: 11px; text-align: center; }
  .hd-date-shell { position: relative; }
  .hd-date-field { display: flex; overflow: hidden; border: 1px solid rgba(255,255,255,.25); border-radius: 8px; background: rgba(0,0,0,.16); }
  .hd-date-text { width: 105px; padding: 7px 4px 7px 9px; border: 0; color: #fff; background: transparent; font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; }
  .hd-date-text:focus { outline: none; }
  .hd-calendar-toggle { width: 30px; border: 0; color: rgba(255,255,255,.75); background: transparent; cursor: pointer; }
  .hd-calendar-toggle:hover { color: #fff; background: rgba(255,255,255,.08); }
  .hd-calendar-popover { width: min(292px, calc(100vw - 48px)); padding: 12px; }
  .hd-calendar-head { display: grid; grid-template-columns: 32px 1fr 32px; align-items: center; margin-bottom: 10px; }
  .hd-calendar-title { margin: 0; color: #fff; font-size: 12px; font-weight: 800; text-align: center; }
  .hd-calendar-nav { display: grid; width: 30px; height: 30px; place-items: center; border: 1px solid rgba(255,255,255,.12); border-radius: 8px; color: rgba(255,255,255,.76); background: rgba(255,255,255,.05); font-size: 17px; cursor: pointer; }
  .hd-calendar-nav:hover { color: #fff; background: rgba(255,255,255,.12); }
  .hd-calendar-week, .hd-calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
  .hd-calendar-week { margin-bottom: 4px; }
  .hd-calendar-week span { color: rgba(255,255,255,.46); font-size: 9px; font-weight: 800; text-align: center; }
  .hd-calendar-day { display: grid; height: 30px; place-items: center; border: 0; border-radius: 7px; color: rgba(255,255,255,.88); background: transparent; font: inherit; font-size: 10px; font-weight: 680; cursor: pointer; }
  .hd-calendar-day:hover { background: rgba(255,255,255,.13); }
  .hd-calendar-day.outside { color: rgba(255,255,255,.32); }
  .hd-calendar-day.today { box-shadow: inset 0 0 0 1px rgba(242,197,111,.72); }
  .hd-calendar-day.selected { color: #28182c; background: #f2c56f; box-shadow: none; }
  .theme-christmas .hd-calendar-day.today { box-shadow: inset 0 0 0 1px rgba(231,211,158,.72); }
  .theme-christmas .hd-calendar-day.selected { color: #17342b; background: #e7d39e; }
  .hd-calendar-foot { display: flex; justify-content: space-between; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,.10); }
  .hd-calendar-foot button { padding: 6px 8px; border: 0; border-radius: 7px; color: #f3cb7b; background: transparent; font: inherit; font-size: 10px; font-weight: 800; cursor: pointer; }
  .theme-christmas .hd-calendar-foot button { color: #ead59f; }
  .hd-calendar-foot button:hover { background: rgba(255,255,255,.09); }
  @media (max-width: 650px) {
    .hd-hero { padding: 62px 20px 18px; }
    .hd-theme-corner { top: 15px; right: 18px; }
    .hd-resolution-flow { grid-template-columns: 1fr; }
    .hd-resolution-step { display: grid; grid-template-columns: 72px 1fr; align-items: center; padding: 8px 10px; }
    .hd-resolution-step span { margin: 0; }
    .hd-main { padding: 0 12px 12px; }
    .hd-workspace-nav { margin: 0 -12px 14px; padding: 9px 12px; }
    .hd-workspace-tab { flex: 1; justify-content: center; }
    .hd-answer { min-height: 0; padding: 17px; }
    .hd-planner-head { flex-direction: column; }
    .hd-time-machine { padding: 16px; }
    .hd-machine-head { flex-direction: column; }
    .hd-machine-result { width: 100%; }
    .hd-budget-row { align-items: flex-start; flex-wrap: wrap; }
    .hd-query-controls { align-items: flex-start; flex-direction: column; }
    .hd-picker-popover { width: min(292px, calc(100vw - 56px)); }
  }
  @media (prefers-reduced-motion: reduce) { .hd-workspace-panel { animation: none; } }
`;

function pad(value) {
  return String(value).padStart(2, "0");
}

export function isoDate(year, month, day) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

function shiftCalendarMonth(cursor, offset) {
  const [year, month] = cursor.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-01`;
}

function createCalendarDays(cursor) {
  const [year, month] = cursor.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const gridStart = new Date(first);
  gridStart.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    return {
      date: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
      day: date.getUTCDate(),
      outside: date.getUTCMonth() + 1 !== month,
    };
  });
}

export function parseQuery(searchData, now = new Date()) {
  const payload = Array.isArray(searchData) ? searchData[0] || {} : searchData || {};
  const query = String(
    payload._processedQuery || payload.query || payload.queryTerm || "",
  ).toLowerCase();
  const explicitYear = query.match(/\b(?:19|20)\d{2}\b/);
  const relativeYear = !explicitYear && /\bnext year\b/.test(query)
    ? now.getFullYear() + 1
    : now.getFullYear();
  let year = explicitYear ? Number(explicitYear[0]) : relativeYear;
  let month = null;

  if (/\bnext month\b/.test(query)) {
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    month = nextMonth.getMonth() + 1;
    if (!explicitYear && !/\b(?:this|next) year\b/.test(query)) {
      year = nextMonth.getFullYear();
    }
  } else if (/\bthis month\b/.test(query)) {
    month = now.getMonth() + 1;
    if (!explicitYear) year = now.getFullYear();
  } else {
    const monthMatch = query.match(new RegExp(`\\b(${MONTH_PATTERN})\\b`, "i"));
    if (monthMatch) month = MONTH_LOOKUP[monthMatch[1].toLowerCase()];
  }

  let day = null;
  let dateMonth = null;
  const monthFirst = query.match(
    new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i"),
  );
  const dayFirst = query.match(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_PATTERN})\\b`, "i"),
  );

  if (monthFirst) {
    dateMonth = MONTH_LOOKUP[monthFirst[1].toLowerCase()];
    day = Number(monthFirst[2]);
  } else if (dayFirst) {
    day = Number(dayFirst[1]);
    dateMonth = MONTH_LOOKUP[dayFirst[2].toLowerCase()];
  }

  let exactDate = day && dateMonth ? isoDate(year, dateMonth, day) : null;
  if (!exactDate) {
    const namedHoliday = (VERIFIED_NAMED_HOLIDAY_DATES[year] || [])
      .find((holiday) => holiday.pattern.test(query));
    if (namedHoliday) {
      dateMonth = namedHoliday.month;
      day = namedHoliday.day;
      exactDate = isoDate(year, dateMonth, day);
    }
  }
  if (dateMonth) month = dateMonth;

  return {
    payload,
    query,
    year,
    month,
    exactDate,
    mode: exactDate ? "exact" : month ? "month" : "year",
  };
}

export function resolveCountry(payload) {
  const entity = payload?.entities?.[0] || {};
  const info = entity.entityInfo || {};
  const rawCode =
    info.countryCode || entity.countryCode || info.geo?.countryCode || "US";
  const code = /^[a-z]{2}$/i.test(String(rawCode))
    ? String(rawCode).toUpperCase()
    : "US";
  let name = info.hdLabel || info.country || info.geo?.country || entity.word;

  if (!name || /^[a-z]{2}$/i.test(String(name))) {
    try {
      name = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    } catch {
      name = code;
    }
  }

  return { code, name: String(name || code) };
}

async function fetchSupportedCountries() {
  if (supportedCountriesCache) return supportedCountriesCache;
  if (supportedCountriesRequest) return supportedCountriesRequest;

  supportedCountriesRequest = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(COUNTRIES_API, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Country service returned ${response.status}`);
      const body = await response.json();
      if (!Array.isArray(body)) throw new Error("Country service returned an invalid response");
      const normalized = body
        .map((item) => ({
          code: String(item.countryCode || "").toUpperCase(),
          name: String(item.name || "").trim(),
        }))
        .filter((item) => /^[A-Z]{2}$/.test(item.code) && item.name);
      if (!normalized.length) throw new Error("Country service returned an empty response");
      supportedCountriesCache = normalized;
      return normalized;
    } finally {
      window.clearTimeout(timeout);
      supportedCountriesRequest = null;
    }
  })();

  return supportedCountriesRequest;
}

async function fetchHolidays(countryCode, year, forceRefresh = false) {
  const key = `${countryCode}-${year}`;
  const cached = holidayCache.get(key);
  if (!forceRefresh && cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.value;
  }

  const request = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${API_BASE}/${countryCode}/${year}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Holiday service returned ${response.status}`);
      if (response.status === 204) {
        const fallback = getVerifiedHolidayFallback(countryCode, year);
        holidayCache.set(key, { createdAt: Date.now(), value: fallback });
        return fallback;
      }
      const body = await response.json();
      if (!Array.isArray(body)) throw new Error("Holiday service returned an invalid response");
      const value = body.length ? body : getVerifiedHolidayFallback(countryCode, year);
      holidayCache.set(key, { createdAt: Date.now(), value });
      return value;
    } finally {
      window.clearTimeout(timeout);
    }
  })();

  holidayCache.set(key, { createdAt: Date.now(), value: request });
  try {
    return await request;
  } catch (error) {
    holidayCache.delete(key);
    throw error;
  }
}

export function clearHolidayCache() {
  holidayCache.clear();
  supportedCountriesCache = null;
  supportedCountriesRequest = null;
}

export function normalizeHoliday(item) {
  const types = item.holidayTypes || item.types || [];
  return {
    ...item,
    name: item.name || item.localName || "Public holiday",
    nationalHoliday: item.nationalHoliday ?? item.global ?? false,
    holidayTypes: Array.isArray(types) ? types : [types].filter(Boolean),
  };
}

function normalizeHolidayList(items) {
  return items
    .map(normalizeHoliday)
    .filter((item) => ISO_DATE_PATTERN.test(item.date || ""))
    .sort((first, second) => first.date.localeCompare(second.date));
}

function dateFromIso(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(value, options) {
  const formatOptions = { timeZone: "UTC", ...options };
  const cacheKey = JSON.stringify(formatOptions);
  if (!dateFormatterCache.has(cacheKey)) {
    dateFormatterCache.set(cacheKey, new Intl.DateTimeFormat("en", formatOptions));
  }
  return dateFormatterCache.get(cacheKey).format(dateFromIso(value));
}

export function distanceLabel(value, now = new Date()) {
  const target = dateFromIso(value);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((target.getTime() - today) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1) return `In ${days} days`;
  return "Passed";
}

export function createPtoHacks(holidays) {
  const sorted = [...holidays].sort((a, b) => a.date.localeCompare(b.date));
  const hacks = [];
  const seen = new Set();
  const add = (key, hack) => {
    if (!seen.has(key)) {
      seen.add(key);
      hacks.push(hack);
    }
  };

  sorted.forEach((holiday) => {
    const weekday = dateFromIso(holiday.date).getUTCDay();
    const label = formatDate(holiday.date, { month: "short", day: "numeric" });
    if (weekday === 1 || weekday === 5) {
      add(`long-${holiday.date}`, {
        kind: "🔥 3-Day Long Weekend",
        title: holiday.name,
        detail: `${label} falls on ${weekday === 1 ? "Monday" : "Friday"} - enjoy the built-in three-day break.`,
      });
    }
    if (weekday === 2 || weekday === 4) {
      const ptoDay = weekday === 2 ? "Monday" : "Friday";
      add(`bridge-${holiday.date}`, {
        kind: "1 PTO → 4 Days Off",
        title: `Bridge ${holiday.name}`,
        detail: `Take ${ptoDay} off around ${label} to create a four-day streak.`,
      });
    }
    if (weekday === 3) {
      add(`gold-${holiday.date}`, {
        kind: "✨ PTO Goldmine",
        title: holiday.name,
        detail: `${label} lands midweek. Take 2 PTO days to get 9 consecutive days off!`,
      });
    }
  });

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const first = sorted[index];
    const second = sorted[index + 1];
    const firstDate = dateFromIso(first.date);
    const secondDate = dateFromIso(second.date);
    const gap = Math.round((secondDate - firstDate) / 86400000);
    if (firstDate.getUTCDay() === 5 && secondDate.getUTCDay() === 1 && gap === 3) {
      add(`pair-${first.date}-${second.date}`, {
        kind: "✨ PTO Goldmine",
        title: `${first.name} + ${second.name}`,
        detail: "Two holidays surround the weekend. Take 2 PTO days to get 9 consecutive days off!",
      });
    }
  }

  return hacks;
}

// Finds the most valuable continuous breaks that can be built from weekends,
// public holidays, and a user-selected PTO budget. This stays fully client-side
// and works only with the holiday year already returned by the API.
export function createPtoWindows(holidays, year, ptoBudget = 2, maxResults = 3) {
  const safeBudget = Math.max(0, Math.min(10, Number(ptoBudget) || 0));
  const holidaysByDate = new Map();

  holidays
    .filter((holiday) => String(holiday.date || "").startsWith(`${year}-`))
    .forEach((holiday) => {
      const names = holidaysByDate.get(holiday.date) || [];
      names.push(holiday.name || "Public holiday");
      holidaysByDate.set(holiday.date, names);
    });

  const days = [];
  for (
    let cursor = new Date(Date.UTC(year, 0, 1));
    cursor.getUTCFullYear() === year;
    cursor = new Date(cursor.getTime() + 86400000)
  ) {
    const iso = `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}`;
    const weekday = cursor.getUTCDay();
    const holidayNames = holidaysByDate.get(iso) || [];
    const weekend = weekday === 0 || weekday === 6;
    days.push({
      date: iso,
      weekend,
      holidayNames,
      ptoCost: !weekend && !holidayNames.length ? 1 : 0,
    });
  }

  const candidates = [];
  for (let start = 0; start < days.length; start += 1) {
    let ptoUsed = 0;
    let holidayCount = 0;
    for (let end = start; end < days.length; end += 1) {
      ptoUsed += days[end].ptoCost;
      if (ptoUsed > safeBudget) break;
      if (days[end].holidayNames.length) holidayCount += 1;
      const totalDays = end - start + 1;
      if (!holidayCount || totalDays < 2) continue;

      const windowDays = days.slice(start, end + 1);
      const ptoDates = windowDays.filter((day) => day.ptoCost).map((day) => day.date);
      const holidayNames = [...new Set(windowDays.flatMap((day) => day.holidayNames))];
      candidates.push({
        start: days[start].date,
        end: days[end].date,
        totalDays,
        ptoUsed,
        freeDays: totalDays - ptoUsed,
        holidayNames,
        ptoDates,
        days: windowDays.map((day) => ({
          ...day,
          kind: day.holidayNames.length ? "holiday" : day.weekend ? "weekend" : "pto",
        })),
      });
    }
  }

  candidates.sort((first, second) =>
    second.totalDays - first.totalDays
    || second.freeDays - first.freeDays
    || first.ptoUsed - second.ptoUsed
    || second.holidayNames.length - first.holidayNames.length
    || first.start.localeCompare(second.start));

  const results = [];
  for (const candidate of candidates) {
    const candidateStart = dateFromIso(candidate.start).getTime();
    const candidateEnd = dateFromIso(candidate.end).getTime();
    const tooSimilar = results.some((existing) => {
      const overlapStart = Math.max(candidateStart, dateFromIso(existing.start).getTime());
      const overlapEnd = Math.min(candidateEnd, dateFromIso(existing.end).getTime());
      const overlapDays = Math.max(0, Math.round((overlapEnd - overlapStart) / 86400000) + 1);
      return overlapDays / Math.min(candidate.totalDays, existing.totalDays) >= 0.6;
    });
    if (!tooSimilar) results.push(candidate);
    if (results.length >= maxResults) break;
  }

  return results;
}

function HolidayTags({ holiday }) {
  const tags = holiday.holidayTypes.length ? holiday.holidayTypes : ["Public"];
  const subdivisions = Array.isArray(holiday.subdivisionCodes)
    ? holiday.subdivisionCodes
    : [];
  return (
    <div className="hd-tags">
      {holiday.nationalHoliday && <span className="hd-tag national">National holiday</span>}
      {tags.map((type) => (
        <span className="hd-tag" key={type}>{type}</span>
      ))}
      {subdivisions.slice(0, 3).map((code) => (
        <span className="hd-tag regional" key={code}>Regional: {code}</span>
      ))}
      {subdivisions.length > 3 && (
        <span className="hd-tag regional">+{subdivisions.length - 3} regions</span>
      )}
    </div>
  );
}

function HolidayRow({ holiday }) {
  return (
    <article className="hd-holiday">
      <time className="hd-date-pill" dateTime={holiday.date}>
        {formatDate(holiday.date, { month: "short", day: "2-digit", year: "numeric" })}
        <span>{formatDate(holiday.date, { weekday: "long" })}</span>
      </time>
      <div>
        <h4 className="hd-holiday-name">{holiday.name}</h4>
        <HolidayTags holiday={holiday} />
      </div>
      <span className="hd-distance">{distanceLabel(holiday.date)}</span>
    </article>
  );
}

function PtoTimeMachine({ holidays, year, countryName }) {
  const [ptoBudget, setPtoBudget] = useState(2);
  const [copiedWindow, setCopiedWindow] = useState("");
  const windows = useMemo(
    () => createPtoWindows(holidays, year, ptoBudget, 3),
    [holidays, ptoBudget, year],
  );
  const bestWindow = windows[0];

  useEffect(() => {
    setPtoBudget(2);
    setCopiedWindow("");
  }, [countryName, year]);

  const copyWindow = async (vacationWindow, index) => {
    const leavePlan = vacationWindow.ptoDates.length
      ? `Take ${vacationWindow.ptoDates.map((date) => formatDate(date, { weekday: "short", month: "short", day: "numeric" })).join(", ")} as PTO`
      : "Use zero PTO days";
    const text = `${countryName} PTO plan: ${leavePlan} to get ${vacationWindow.totalDays} consecutive days off, ${formatDate(vacationWindow.start, { month: "short", day: "numeric" })}–${formatDate(vacationWindow.end, { month: "short", day: "numeric", year: "numeric" })}, around ${vacationWindow.holidayNames.join(" + ")}.`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const input = document.createElement("textarea");
      input.value = text;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setCopiedWindow(String(index));
    window.setTimeout(() => setCopiedWindow(""), 1400);
  };

  return (
    <section className="hd-time-machine" aria-labelledby="time-machine-heading">
      <div className="hd-machine-orbit" aria-hidden="true" />
      <header className="hd-machine-head">
        <div>
          <span className="hd-machine-eyebrow">Live optimization engine</span>
          <h2 id="time-machine-heading">PTO Time Machine</h2>
          <p>Choose a leave budget. The calendar searches every day of {year} for your highest-value uninterrupted breaks.</p>
        </div>
        <div className="hd-machine-result" aria-live="polite">
          <span>Best result</span>
          <strong>
            {bestWindow
              ? bestWindow.ptoUsed
                ? `${bestWindow.ptoUsed} PTO → ${bestWindow.totalDays} days off`
                : `${bestWindow.totalDays} days off · zero PTO`
              : "No match"}
          </strong>
        </div>
      </header>

      <div className="hd-budget-row">
        <span>My PTO budget</span>
        <div className="hd-budget-options" role="group" aria-label="PTO day budget">
          {[0, 1, 2, 3, 4, 5].map((budget) => (
            <button
              className={ptoBudget === budget ? "active" : ""}
              type="button"
              aria-pressed={ptoBudget === budget}
              onClick={() => setPtoBudget(budget)}
              key={budget}
            >
              {budget}
            </button>
          ))}
        </div>
        <span>{ptoBudget === 1 ? "day" : "days"}</span>
      </div>

      {windows.length ? (
        <div className="hd-window-grid">
          {windows.map((vacationWindow, index) => (
            <article className={`hd-window-card ${index === 0 ? "best" : ""}`} key={`${vacationWindow.start}-${vacationWindow.end}`}>
              <div className="hd-window-topline">
                <span className="hd-window-rank">#{index + 1} window</span>
                <span>{vacationWindow.freeDays} free days in the streak</span>
              </div>
              <div className="hd-window-title-row">
                <div>
                  <strong>{vacationWindow.totalDays} consecutive days</strong>
                  <span>
                    {formatDate(vacationWindow.start, { month: "short", day: "numeric" })}–{formatDate(vacationWindow.end, { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
                <button
                  className="hd-window-copy"
                  type="button"
                  onClick={() => copyWindow(vacationWindow, index)}
                  aria-label={`Copy PTO window ${index + 1}`}
                >
                  {copiedWindow === String(index) ? "Copied" : "Copy plan"}
                </button>
              </div>

              <div className="hd-window-strip" aria-label={`Day-by-day plan for window ${index + 1}`}>
                {vacationWindow.days.map((day) => (
                  <div
                    className={`hd-window-day ${day.kind}`}
                    title={day.holidayNames.join(" / ") || (day.kind === "pto" ? "Take PTO" : "Weekend")}
                    aria-label={`${formatDate(day.date, { weekday: "long", month: "long", day: "numeric" })}: ${day.holidayNames.join(" / ") || (day.kind === "pto" ? "take PTO" : "weekend")}`}
                    key={day.date}
                  >
                    <span>{formatDate(day.date, { weekday: "narrow" })}</span>
                    <strong>{Number(day.date.slice(-2))}</strong>
                    <i>{day.kind === "holiday" ? "H" : day.kind === "pto" ? "P" : "W"}</i>
                  </div>
                ))}
              </div>

              <div className="hd-window-plan">
                <span><b>Holiday anchor</b> {vacationWindow.holidayNames.join(" + ")}</span>
                <span>
                  <b>Book as PTO</b>{" "}
                  {vacationWindow.ptoDates.length
                    ? vacationWindow.ptoDates.map((date) => formatDate(date, { weekday: "short", month: "short", day: "numeric" })).join(", ")
                    : "Nothing — this break is already built in"}
                </span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="hd-machine-empty">
          No multi-day holiday window fits this budget. Add a PTO day to unlock more combinations.
        </div>
      )}

      <footer className="hd-machine-legend" aria-label="PTO timeline legend">
        <span><i className="holiday" /> H · Public holiday</span>
        <span><i className="weekend" /> W · Weekend</span>
        <span><i className="pto" /> P · PTO day</span>
      </footer>
    </section>
  );
}

export default function HolidayCalendar(props) {
  const parsed = useMemo(() => parseQuery(props.searchData), [props.searchData]);
  const resolvedCountry = useMemo(() => resolveCountry(parsed.payload), [parsed.payload]);
  const [selectedCountryCode, setSelectedCountryCode] = useState(resolvedCountry.code);
  const [holidays, setHolidays] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [retryToken, setRetryToken] = useState(0);
  const [followingYearHoliday, setFollowingYearHoliday] = useState(null);
  const [theme, setTheme] = useState("diwali");
  const [activePanel, setActivePanel] = useState("calendar");
  const [showExactExplorer, setShowExactExplorer] = useState(false);
  const [dateOverride, setDateOverride] = useState("");
  const [countryMenuOpen, setCountryMenuOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarCursor, setCalendarCursor] = useState(
    parsed.exactDate
      ? `${parsed.exactDate.slice(0, 7)}-01`
      : `${parsed.year}-${pad(parsed.month || new Date().getMonth() + 1)}-01`,
  );
  const [availableCountries, setAvailableCountries] = useState(null);
  const [countryListStatus, setCountryListStatus] = useState("idle");
  const [calendarMonth, setCalendarMonth] = useState(
    parsed.month ? String(parsed.month) : "all",
  );
  const loadedNotified = useRef(false);
  const countryPickerRef = useRef(null);
  const datePickerRef = useRef(null);

  const countryOptions = useMemo(() => {
    const byCode = new Map();
    [...(availableCountries || []), ...COUNTRY_OPTIONS, resolvedCountry].forEach((option) => {
      if (!byCode.has(option.code)) byCode.set(option.code, option);
    });
    return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [availableCountries, resolvedCountry]);
  const filteredCountryOptions = useMemo(() => {
    const search = countrySearch.trim().toLowerCase();
    if (!search) return countryOptions;
    return countryOptions.filter((option) =>
      option.name.toLowerCase().includes(search) || option.code.toLowerCase().includes(search));
  }, [countryOptions, countrySearch]);

  const country = useMemo(
    () => selectedCountryCode === resolvedCountry.code
      ? resolvedCountry
      : countryOptions.find((option) => option.code === selectedCountryCode) || resolvedCountry,
    [countryOptions, resolvedCountry, selectedCountryCode],
  );
  const countryHasLiveCoverage = !KNOWN_UNSUPPORTED_NAGER_COUNTRIES.has(country.code)
    && (!availableCountries || availableCountries.some((option) => option.code === country.code));
  const effectiveExactDate = dateOverride || parsed.exactDate;
  const effectiveYear = dateOverride ? Number(dateOverride.slice(0, 4)) : parsed.year;
  const effectiveMonth = dateOverride ? Number(dateOverride.slice(5, 7)) : parsed.month;
  const effectiveMode = effectiveExactDate ? "exact" : effectiveMonth ? "month" : "year";
  const calendarDays = useMemo(() => createCalendarDays(calendarCursor), [calendarCursor]);
  const calendarTitle = formatDate(calendarCursor, { month: "long", year: "numeric" });
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  useEffect(() => {
    setSelectedCountryCode(resolvedCountry.code);
  }, [resolvedCountry.code]);

  useEffect(() => {
    const closePickers = (event) => {
      if (!countryPickerRef.current?.contains(event.target)) setCountryMenuOpen(false);
      if (!datePickerRef.current?.contains(event.target)) setCalendarOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setCountryMenuOpen(false);
        setCalendarOpen(false);
      }
    };
    document.addEventListener("mousedown", closePickers);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closePickers);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const loadCountryOptions = () => {
    if (countryListStatus === "loading" || countryListStatus === "ready") return;
    setCountryListStatus("loading");
    fetchSupportedCountries()
      .then((items) => {
        setAvailableCountries(items);
        setCountryListStatus("ready");
      })
      .catch(() => {
        // The documented fallback remains usable when country discovery fails.
        setCountryListStatus("fallback");
      });
  };

  useEffect(() => {
    setDateOverride("");
    setCalendarMonth(parsed.month ? String(parsed.month) : "all");
    setActivePanel("calendar");
    setShowExactExplorer(false);
  }, [parsed.month, parsed.year, parsed.mode, parsed.exactDate, parsed.query]);

  useEffect(() => {
    const month = effectiveExactDate?.slice(0, 7)
      || `${effectiveYear}-${pad(effectiveMonth || new Date().getMonth() + 1)}`;
    setCalendarCursor(`${month}-01`);
  }, [effectiveExactDate, effectiveMonth, effectiveYear]);

  const handleDateChange = (value) => {
    setDateOverride(value);
    setActivePanel("calendar");
    setShowExactExplorer(false);
    setCalendarMonth(value ? String(Number(value.slice(5, 7))) : parsed.month ? String(parsed.month) : "all");
  };

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setError("");
    fetchHolidays(country.code, effectiveYear, retryToken > 0)
      .then((items) => {
        if (!active) return;
        setHolidays(normalizeHolidayList(items));
        setStatus("success");
      })
      .catch((requestError) => {
        if (!active) return;
        setError(
          requestError?.name === "AbortError"
            ? "The holiday service took too long to respond."
            : requestError?.message || "Holiday data could not be loaded.",
        );
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [country.code, effectiveYear, retryToken]);

  useEffect(() => {
    if (status !== "loading" && !loadedNotified.current) {
      props?.messageHandlers?.componentLoaded?.();
      loadedNotified.current = true;
    }
  }, [props?.messageHandlers, status]);

  const visibleHolidays = useMemo(() => {
    if (calendarMonth !== "all") {
      const prefix = `${effectiveYear}-${pad(calendarMonth)}`;
      return holidays.filter((holiday) => holiday.date.startsWith(prefix));
    }
    return holidays;
  }, [holidays, effectiveYear, calendarMonth]);

  const groupedHolidays = useMemo(() => {
    const groups = new Map();
    visibleHolidays.forEach((holiday) => {
      const monthKey = holiday.date.slice(0, 7);
      if (!groups.has(monthKey)) groups.set(monthKey, []);
      groups.get(monthKey).push(holiday);
    });
    return [...groups.entries()];
  }, [visibleHolidays]);

  const hacks = useMemo(() => createPtoHacks(visibleHolidays), [visibleHolidays]);
  const activeMonth = calendarMonth === "all" ? null : Number(calendarMonth);
  const monthName = activeMonth
    ? formatDate(`${effectiveYear}-${pad(activeMonth)}-01`, { month: "long" })
    : null;
  const queryMonthName = effectiveMonth
    ? formatDate(`${effectiveYear}-${pad(effectiveMonth)}-01`, { month: "long" })
    : null;
  const resolvedLabel = effectiveExactDate
    ? formatDate(effectiveExactDate, { month: "short", day: "numeric", year: "numeric" })
    : queryMonthName
      ? `${queryMonthName} ${effectiveYear}`
      : String(effectiveYear);
  const modeLabel = effectiveMode === "exact"
    ? "Exact date check"
    : effectiveMode === "month"
      ? "Monthly calendar"
      : "Yearly calendar";
  const exactMatches = effectiveMode === "exact"
    ? holidays.filter((holiday) => holiday.date === effectiveExactDate)
    : [];
  const usesVerifiedFallback = holidays.some((holiday) => holiday.verifiedFallback);
  const usesYearSpecificIndiaFallback = holidays.some((holiday) => holiday.yearSpecificFallback);
  const exactAnswerState = exactMatches.length
    ? "yes"
    : countryHasLiveCoverage || usesYearSpecificIndiaFallback
      ? "no"
      : "unknown";
  const nextHoliday =
    effectiveMode === "exact"
      ? holidays.find((holiday) => holiday.date > effectiveExactDate)
      : null;

  useEffect(() => {
    let active = true;
    setFollowingYearHoliday(null);
    if (
      status !== "success" ||
      effectiveMode !== "exact" ||
      exactMatches.length ||
      nextHoliday ||
      !countryHasLiveCoverage
    ) {
      return () => {
        active = false;
      };
    }

    fetchHolidays(country.code, effectiveYear + 1)
      .then((items) => {
        if (!active) return;
        const first = normalizeHolidayList(items)[0];
        setFollowingYearHoliday(first || null);
      })
      .catch(() => {
        // The direct answer remains valid even if the optional next-year lookup fails.
      });
    return () => {
      active = false;
    };
  }, [country.code, countryHasLiveCoverage, effectiveExactDate, effectiveMode, effectiveYear, exactMatches.length, nextHoliday, status]);

  const upcomingHoliday = nextHoliday || followingYearHoliday;
  const longWeekendCount = visibleHolidays.filter((holiday) => {
    const day = dateFromIso(holiday.date).getUTCDay();
    return day === 1 || day === 5;
  }).length;

  return (
    <section className={`hd-calendar theme-${theme}`} aria-busy={status === "loading"}>
      <style>{styles}</style>
      <header className="hd-hero">
        <div className="hd-theme-corner">
          <span className="hd-theme-label">Theme</span>
          <div className="hd-theme-switcher" role="group" aria-label="Festival theme">
            <button
              className={`hd-theme-button ${theme === "diwali" ? "active" : ""}`}
              type="button"
              aria-pressed={theme === "diwali"}
              onClick={() => setTheme("diwali")}
            >
              Diwali
            </button>
            <button
              className={`hd-theme-button ${theme === "christmas" ? "active" : ""}`}
              type="button"
              aria-pressed={theme === "christmas"}
              onClick={() => setTheme("christmas")}
            >
              Christmas
            </button>
          </div>
        </div>
        <div className="hd-hero-row">
          <div className="hd-identity">
            <span className="hd-flag" aria-label={`${country.name} country code`}>{country.code}</span>
            <div>
              <p className="hd-kicker">Public holiday calendar</p>
              <h1 className="hd-title">{country.name}</h1>
              <div className="hd-query-controls">
                <div className="hd-country-control hd-picker" ref={countryPickerRef}>
                  <span className="hd-picker-label" id="hd-country-label">Country</span>
                  <button
                    className="hd-country-trigger"
                    type="button"
                    aria-label="Country"
                    aria-haspopup="listbox"
                    aria-expanded={countryMenuOpen}
                    onClick={() => {
                      setCountryMenuOpen((value) => !value);
                      setCalendarOpen(false);
                      setCountrySearch("");
                      loadCountryOptions();
                    }}
                  >
                    <span>{country.name}</span>
                  </button>
                  <span className="hd-country-count" aria-live="polite">
                    {countryListStatus === "loading"
                      ? "Loading…"
                      : countryListStatus === "ready"
                        ? `${availableCountries.length} supported`
                        : ""}
                  </span>
                  {countryMenuOpen && (
                    <div className="hd-picker-popover" aria-label="Country picker">
                      <div className="hd-country-search-wrap">
                        <input
                          className="hd-country-search"
                          type="search"
                          aria-label="Search countries"
                          placeholder="Search country or code"
                          value={countrySearch}
                          onChange={(event) => setCountrySearch(event.target.value)}
                          autoFocus
                        />
                      </div>
                      <div className="hd-country-options" role="listbox" aria-label="Countries">
                        {filteredCountryOptions.length ? filteredCountryOptions.map((option) => (
                          <button
                            className="hd-country-option"
                            type="button"
                            role="option"
                            aria-label={option.name}
                            aria-selected={option.code === country.code}
                            key={option.code}
                            onClick={() => {
                              setSelectedCountryCode(option.code);
                              setCountryMenuOpen(false);
                            }}
                          >
                            <span>{option.name}</span>
                            <span className="hd-country-code">{option.code}</span>
                          </button>
                        )) : (
                          <div className="hd-country-none">No countries match “{countrySearch}”.</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="hd-date-control hd-picker" ref={datePickerRef}>
                  <label className="hd-picker-label" htmlFor="hd-date-picker">Check date</label>
                  <div className="hd-date-shell">
                    <div className="hd-date-field">
                      <input
                        className="hd-date-text"
                        id="hd-date-picker"
                        type="text"
                        inputMode="none"
                        placeholder="YYYY-MM-DD"
                        value={effectiveExactDate || ""}
                        readOnly
                        onClick={() => {
                          setCalendarOpen(true);
                          setCountryMenuOpen(false);
                        }}
                        onChange={(event) => handleDateChange(event.target.value)}
                      />
                      <button
                        className="hd-calendar-toggle"
                        type="button"
                        aria-label="Open calendar"
                        aria-expanded={calendarOpen}
                        onClick={() => {
                          setCalendarOpen((value) => !value);
                          setCountryMenuOpen(false);
                        }}
                      >
                        ▦
                      </button>
                    </div>
                    {calendarOpen && (
                      <div className="hd-picker-popover hd-calendar-popover" role="dialog" aria-label="Choose a date">
                        <div className="hd-calendar-head">
                          <button className="hd-calendar-nav" type="button" aria-label="Previous month" onClick={() => setCalendarCursor((value) => shiftCalendarMonth(value, -1))}>‹</button>
                          <h2 className="hd-calendar-title">{calendarTitle}</h2>
                          <button className="hd-calendar-nav" type="button" aria-label="Next month" onClick={() => setCalendarCursor((value) => shiftCalendarMonth(value, 1))}>›</button>
                        </div>
                        <div className="hd-calendar-week" aria-hidden="true">
                          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => <span key={day}>{day}</span>)}
                        </div>
                        <div className="hd-calendar-grid">
                          {calendarDays.map((day) => (
                            <button
                              className={`hd-calendar-day ${day.outside ? "outside" : ""} ${day.date === effectiveExactDate ? "selected" : ""} ${day.date === todayIso ? "today" : ""}`}
                              type="button"
                              aria-label={`Choose ${formatDate(day.date, { month: "long", day: "numeric", year: "numeric" })}`}
                              aria-pressed={day.date === effectiveExactDate}
                              key={day.date}
                              onClick={() => {
                                handleDateChange(day.date);
                                setCalendarOpen(false);
                              }}
                            >
                              {day.day}
                            </button>
                          ))}
                        </div>
                        <div className="hd-calendar-foot">
                          <button type="button" onClick={() => { handleDateChange(""); setCalendarOpen(false); }}>
                            {parsed.exactDate ? "Use query date" : "Clear"}
                          </button>
                          <button type="button" onClick={() => { handleDateChange(todayIso); setCalendarOpen(false); }}>
                            Today
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  {dateOverride && (
                    <button className="hd-date-reset" type="button" onClick={() => handleDateChange("")}>
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="hd-hero-meta">
            <span className="hd-live">Live holiday data</span>
            <span className="hd-resolved">{resolvedLabel}</span>
          </div>
        </div>
        <ol className="hd-resolution-flow" aria-label="Resolved query">
          <li className="hd-resolution-step">
            <span>Country</span>
            <strong>{country.name}</strong>
          </li>
          <li className="hd-resolution-step">
            <span>Period</span>
            <strong>{resolvedLabel}</strong>
          </li>
          <li className="hd-resolution-step">
            <span>Result type</span>
            <strong>{modeLabel}</strong>
          </li>
        </ol>
      </header>

      {status === "loading" && (
        <div className="hd-state" role="status" aria-live="polite">
          <div className="hd-spinner" aria-hidden="true" />
          <h2>Finding public holidays</h2>
          <p>Checking the official calendar for {country.name}…</p>
        </div>
      )}

      {status === "error" && (
        <div className="hd-state" role="alert">
          <h2>We couldn’t load the calendar</h2>
          <p>{error} Check your connection and try again.</p>
          <button className="hd-retry" type="button" onClick={() => setRetryToken((value) => value + 1)}>
            Retry
          </button>
        </div>
      )}

      {status === "success" && (
        <main className="hd-main">
          <nav className="hd-workspace-nav" aria-label="Holiday planner sections">
            <button
              className={`hd-workspace-tab ${activePanel === "calendar" ? "active" : ""}`}
              type="button"
              aria-current={activePanel === "calendar" ? "page" : undefined}
              onClick={() => setActivePanel("calendar")}
            >
              Calendar
              <span className="hd-tab-count">{visibleHolidays.length}</span>
            </button>
            <button
              className={`hd-workspace-tab ${activePanel === "planner" ? "active" : ""}`}
              type="button"
              aria-current={activePanel === "planner" ? "page" : undefined}
              onClick={() => setActivePanel("planner")}
            >
              PTO Time Machine
            </button>
          </nav>

          {activePanel === "calendar" && (
            <div className="hd-workspace-panel">
              {effectiveMode === "exact" && (
                <>
                  <section className={`hd-card hd-answer ${exactAnswerState}`} aria-live="polite">
                    <span className="hd-answer-badge">
                      {exactAnswerState === "yes" ? "YES" : exactAnswerState === "no" ? "NO" : "LIMITED COVERAGE"}
                    </span>
                    <div>
                      <h2>
                        {exactMatches.length
                          ? exactMatches.map((item) => item.name).join(" / ")
                          : exactAnswerState === "unknown"
                            ? "This date needs regional verification"
                            : "Not a public holiday"}
                      </h2>
                      {exactMatches.length ? (
                        <>
                          <p>{formatDate(effectiveExactDate, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
                          <HolidayTags holiday={exactMatches[0]} />
                        </>
                      ) : (
                        <>
                          <p>
                            {exactAnswerState === "unknown"
                              ? `${formatDate(effectiveExactDate, { month: "long", day: "numeric", year: "numeric" })} is not one of the verified fixed national holidays available for ${country.name}. Check the relevant state or employer calendar for local observances.`
                              : usesYearSpecificIndiaFallback
                                ? `${formatDate(effectiveExactDate, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} is not listed in the verified all-India public holiday calendar.`
                                : `${formatDate(effectiveExactDate, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} is not listed as a public holiday in ${country.name}.`}
                          </p>
                          {exactAnswerState === "no" && upcomingHoliday && (
                            <p className="hd-next"><strong>Next holiday:</strong> {upcomingHoliday.name} · {formatDate(upcomingHoliday.date, { month: "short", day: "numeric", year: "numeric" })}</p>
                          )}
                        </>
                      )}
                    </div>
                  </section>
                  {!showExactExplorer && (
                    <div className="hd-answer-actions">
                      <button className="hd-action primary" type="button" onClick={() => setShowExactExplorer(true)}>
                        Explore {queryMonthName} holidays
                      </button>
                      <button className="hd-action" type="button" onClick={() => setActivePanel("planner")}>
                        Open PTO Time Machine
                      </button>
                    </div>
                  )}
                </>
              )}

              {(effectiveMode !== "exact" || showExactExplorer) && (
                <>
                  <section className="hd-stats" aria-label="Calendar overview">
                    <div className="hd-stat">
                      <span className="hd-stat-value">{visibleHolidays.length}</span>
                      <span className="hd-stat-label">Public holidays</span>
                    </div>
                    <div className="hd-stat">
                      <span className="hd-stat-value">{longWeekendCount}</span>
                      <span className="hd-stat-label">Long weekends</span>
                    </div>
                    <div className="hd-stat">
                      <span className="hd-stat-value">{hacks.length}</span>
                      <span className="hd-stat-label">PTO ideas</span>
                    </div>
                  </section>

                  <section className="hd-card hd-calendar-card" aria-labelledby="holidays-heading">
                    <div className="hd-toolbar">
                      <h2 className="hd-section-title" id="holidays-heading">
                        {monthName ? `${monthName} holidays` : `${effectiveYear} calendar`}
                      </h2>
                      <div className="hd-filter">
                        <label htmlFor="hd-month-filter">Period</label>
                        <select
                          className="hd-select"
                          id="hd-month-filter"
                          value={calendarMonth}
                          onChange={(event) => setCalendarMonth(event.target.value)}
                        >
                          <option value="all">Full year</option>
                          {MONTHS.map((names, index) => (
                            <option value={String(index + 1)} key={names[0]}>
                              {names[0][0].toUpperCase() + names[0].slice(1)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {!visibleHolidays.length ? (
                      <div className="hd-empty">
                        {usesVerifiedFallback
                          ? `No ${usesYearSpecificIndiaFallback ? "all-India" : "fixed national"} holiday is listed for ${monthName ? `${monthName} ${effectiveYear}` : effectiveYear} in the verified India fallback. Movable, state and regional holidays may differ.`
                          : !countryHasLiveCoverage
                          ? `Nager.Date does not currently list holiday coverage for ${country.name}.`
                          : monthName
                            ? `No public holidays found for ${monthName} ${effectiveYear} in ${country.name}`
                            : `No public holidays found for ${effectiveYear} in ${country.name}`}
                      </div>
                    ) : (
                      groupedHolidays.map(([monthKey, items]) => (
                        <details
                          className="hd-month"
                          key={monthKey}
                          open={calendarMonth !== "all" || groupedHolidays.length === 1}
                        >
                          <summary className="hd-month-summary">
                            <h3 className="hd-month-label">
                              {formatDate(`${monthKey}-01`, { month: "long", year: "numeric" })}
                            </h3>
                            <span className="hd-month-count">{items.length} {items.length === 1 ? "holiday" : "holidays"}</span>
                          </summary>
                          <div className="hd-list">
                            {items.map((holiday, index) => (
                              <HolidayRow holiday={holiday} key={`${holiday.date}-${holiday.name}-${index}`} />
                            ))}
                          </div>
                        </details>
                      ))
                    )}
                  </section>
                </>
              )}
            </div>
          )}

          {activePanel === "planner" && (
            <div className="hd-workspace-panel">
              <PtoTimeMachine holidays={holidays} year={effectiveYear} countryName={country.name} />
            </div>
          )}
        </main>
      )}
    </section>
  );
}
