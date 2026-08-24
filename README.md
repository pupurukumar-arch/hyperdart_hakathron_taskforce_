# Holiday Calendar + Smart PTO Optimizer

A HyperDart React component that resolves a country from `props.searchData`, parses date intent locally, retrieves the full holiday year from Nager.Date v4, and presents exact-date, monthly, or yearly results.

## Supported queries

- `Holidays in USA 2026`
- `Public holidays in UK next year`
- `Holidays in Japan July 2026`
- `Holidays in the US next month`
- `Is July 4 a holiday in USA 2026`
- `List of holidays in Japan for July`

## Local development

Node.js 20.19 or newer is required by the current Vite React plugin.

```bash
npm install
npm start
```

The HyperDart sandbox reads its sample payload from `searchData.json`.

## Validation

```bash
npm test
npm run build
```

## Runtime behavior

1. Reads the first resolved location entity from `props.searchData`.
2. Resolves an ISO alpha-2 country code, falling back to `US`.
3. Parses explicit/relative years, explicit/relative months, and named exact dates from `_processedQuery` or `query`.
4. Calls `GET https://date.nager.at/api/v4/Holidays/{CountryCode}/{Year}`.
5. Filters the returned yearly array locally and renders the appropriate query mode.
6. Detects long weekends, bridge-day PTO opportunities, and PTO goldmines.

The component includes request caching, timeout handling, retry UI, empty states, responsive layouts, regional subdivision tags, and the HyperDart `componentLoaded` notification. The country picker loads Nager.Date's current supported-country list from `GET /api/v4/Countries/Available` on demand, while retaining the countries documented by the case study as an offline fallback. A visible date picker can override the query date, switch into exact-date mode, and refetch automatically when the selected year changes.

The component has two primary views: **Calendar** and **PTO Time Machine**. In the Time Machine, a user selects a budget from zero to five leave days, and a client-side optimization engine scans every continuous date window in the resolved year. It ranks the best holiday-anchored breaks, renders a day-by-day holiday/weekend/PTO timeline, identifies the exact leave dates to book, and provides copy-ready plans without making another API request.

Nager.Date currently returns `204 No Content` for India and omits `IN` from its supported-country list. For India 2026, the component transparently provides the 14 source-labelled all-India holidays published in India Post's official calendar, including Republic Day, Independence Day, Diwali, and Christmas. For every other requested year, it generates the three fixed national dates verified by the Government of India: Republic Day (26 January), Independence Day (15 August), and Mahatma Gandhi's Birthday (2 October). Movable, state, and regional holidays can differ, so an exact date absent from the available national fallback shows `UNKNOWN` rather than an invented negative answer.
