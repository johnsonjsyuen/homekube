# UV Chart Feature Spec (Implementation)

## 1. Problem Statement

Users currently see a **single UV index number** in the Weather tab stats grid. This gives a point-in-time snapshot but no visibility into how UV changes throughout the day. ARPANSA publishes a real-time UV chart showing both **measured** and **forecast** UV levels minute-by-minute. Embedding this chart at the bottom of the Weather tab gives users the full daily UV curve, enabling sun-safety decisions like "when is it safe to go outside."

**Implementation Implication:** Add a new Chart.js time-series chart component below the 7-Day Forecast section in `WeatherTab.svelte`, powered by the ARPANSA JSON API.

---

## 2. Architecture Decision: Why Chart.js Over iframe

Three options were evaluated:

| Option | Approach | Verdict |
|--------|----------|---------|
| **A: iframe** | `<iframe src="https://uvdata.arpansa.gov.au/UVLevel">` | Rejected |
| **B: Chart.js native** | Fetch ARPANSA JSON API, render with Chart.js | **Selected** |
| **C: Embed ARPANSA JS** | Load jQuery + amCharts + ARPANSA scripts | Rejected |

### Why iframe was rejected
- ARPANSA page loads jQuery, Bootstrap CSS, amCharts v3 (legacy) = ~500KB+ overhead
- Full page includes its own location selector, date picker, settings modal - duplicates our UI
- Light theme only - cannot match our dark theme (#1a1a1a background)
- No `X-Frame-Options` header so it _would_ work, but UX is poor

### Why direct JS embed was rejected
- jQuery + Bootstrap CSS conflict with SvelteKit + Tailwind
- amCharts v3 pollutes global scope
- Extremely fragile; any ARPANSA deploy could break it
- Style conflicts are unresolvable without Shadow DOM

### Why Chart.js native was selected
- `chart.js@4.4.1` is already in `package.json`
- ARPANSA JSON API has `access-control-allow-origin: *` (CORS fully open)
- API returns clean JSON with `GraphData[].Date`, `GraphData[].Forecast`, `GraphData[].Measured`
- Full styling control to match dark theme
- Server-side fetching + caching aligns with existing `+page.server.ts` pattern
- Hourly `TableData` available as lightweight alternative to minute-by-minute `GraphData`

---

## 3. Data Source

### ARPANSA UV Level API

**Endpoint:** `https://uvdata.arpansa.gov.au/api/uvlevel/?longitude={lon}&latitude={lat}&date={DD-MM-YYYY}`

**Response structure:**

```json
{
  "GraphData": [
    { "Date": "2026-02-27 06:00", "Forecast": 0.0, "Measured": 0.007 },
    { "Date": "2026-02-27 06:01", "Forecast": 0.0, "Measured": 0.007 }
  ],
  "TableData": [
    { "Date": "2026-02-27 06:00", "Forecast": "0.0", "Measured": "0.0" },
    { "Date": "2026-02-27 09:00", "Forecast": "1.1", "Measured": "n/a" }
  ],
  "CurrentDateTime": "27-02-2026 10:30",
  "CurrentUVIndex": 3.2,
  "MaximumUVLevel": 8.5,
  "MaximumUVLevelDateTime": "2026-02-27 13:00"
}
```

**Key characteristics:**
- `GraphData`: ~840 entries (minute-by-minute from 06:00-20:00 local time)
- `TableData`: ~14 entries (hourly summary, `Measured` is `"n/a"` for future hours)
- `Measured` is `null` for future times in `GraphData`
- `Forecast` is the calculated/predicted UV curve for the full day
- CORS: `access-control-allow-origin: *` (no proxy needed)

### Station Coordinates

**Endpoint:** `https://uvdata.arpansa.gov.au/api/categoriesSites`

| Homekube Location | ARPANSA Station | Latitude | Longitude |
|-------------------|-----------------|----------|-----------|
| `port_melbourne` | Melbourne | -37.73 | 145.1 |
| `sydney` | Sydney | -34.04 | 151.1 |
| `hong_kong` | _(no station)_ | N/A | N/A |

**Implementation Implication:** UV chart only displays for Australian locations that have ARPANSA stations. Hong Kong and other non-AU locations hide the chart section entirely.

---

## 4. Data Flow

```
+page.server.ts (server-side)
  │
  ├── fetchUVChartData(lon, lat)     ← NEW function
  │     └── GET /api/uvlevel/?longitude=X&latitude=Y&date=today
  │     └── Return TableData (hourly) for chart
  │
  └── return { ...existing, uvChartData, uvChartMax, uvChartMaxTime }
                    │
                    ▼
            WeatherTab.svelte
                    │
                    ▼
            UvChart.svelte (NEW component)
              └── Chart.js line chart
                  └── Forecast line (full day)
                  └── Measured line (up to current time)
                  └── UV band fills (0-3 green, 3-6 yellow, 6-8 orange, 8-11 red, 11+ purple)
```

---

## 5. Component Specification: `UvChart.svelte`

### Location
`/homepage/src/routes/UvChart.svelte`

### Props

| Prop | Type | Description |
|------|------|-------------|
| `chartData` | `{ Date: string, Forecast: string, Measured: string }[]` | Hourly UV data from `TableData` |
| `maxUV` | `number` | Peak UV for the day |
| `maxUVTime` | `string \| null` | Time of peak UV |

### Visual Design

- **Container:** Same card style as 7-Day Forecast section (`background: #2a2a2a`, `border-radius: 20px`, `padding: 20px`)
- **Title:** "UV Forecast" (same style as "7-Day Forecast" heading)
- **Chart type:** Line chart with filled area under forecast curve
- **X-axis:** Hours (6 AM to 8 PM), labels in `h A` format (e.g., "9 AM", "1 PM")
- **Y-axis:** UV Index (0 to max(14, peak+2)), labeled "UV Index"
- **Forecast line:** Solid line, `#4a90e2` (matches active tab/card accent color)
- **Measured line:** Solid line, `#4ade80` (green, matches existing UV "low" color)
- **UV risk bands:** Horizontal colored zones as background fills:
  - 0-3: `rgba(74, 222, 128, 0.1)` (green, low)
  - 3-6: `rgba(250, 204, 21, 0.1)` (yellow, moderate)
  - 6-8: `rgba(251, 146, 60, 0.1)` (orange, high)
  - 8-11: `rgba(248, 113, 113, 0.1)` (red, very high)
  - 11+: `rgba(192, 132, 252, 0.1)` (purple, extreme)
- **Grid lines:** `#333` (subtle on dark background)
- **Axis text:** `#888` (matches existing stat-label color)
- **Tooltip:** Show both Forecast and Measured values on hover
- **Peak indicator:** Display "Peak: {maxUV} at {maxUVTime}" as subtitle text below chart title
- **Attribution:** Small text below chart: "Source: ARPANSA" in `#666`

### Responsive Behavior

- Chart fills container width (100%)
- Height: 250px on desktop, 200px on mobile (< 480px)
- X-axis labels rotate 0 degrees (horizontal) - hourly intervals provide enough space

---

## 6. Server-Side Changes: `+page.server.ts`

### New UV Chart Location Map

```typescript
const UV_CHART_COORDS: Record<string, { lat: number; lon: number }> = {
    "port_melbourne": { lat: -37.73, lon: 145.1 },
    "sydney": { lat: -34.04, lon: 151.1 }
};
```

### New Function: `fetchUVChartData`

- Fetch from ARPANSA API with today's date (formatted as `DD-MM-YYYY` in the station's local timezone)
- Use `fetchWithRetry` with same retry/timeout pattern as existing `fetchUVData()`
- Cache in a new `uvChartCache` with same 15-minute refresh pattern
- Cache key: location key (e.g., `"port_melbourne"`)
- Return `TableData` array (hourly), `MaximumUVLevel`, `MaximumUVLevelDateTime`
- On failure: return `null` (chart section hides gracefully)

### New Return Fields from `load()`

| Field | Type | Description |
|-------|------|-------------|
| `uvChartData` | `{ Date: string, Forecast: string, Measured: string }[] \| null` | Hourly table data |
| `uvChartMax` | `number \| null` | Peak UV level |
| `uvChartMaxTime` | `string \| null` | Time of peak UV |

---

## 7. Placement in WeatherTab

Insert after the 7-Day Forecast section (`{/if}` on line 150), before `{/if}` on line 151:

```
... 7-Day Forecast ...

{#if data.uvChartData}
    <UvChart
        chartData={data.uvChartData}
        maxUV={data.uvChartMax}
        maxUVTime={data.uvChartMaxTime}
    />
{/if}
```

Chart only renders when `uvChartData` is non-null (i.e., Australian locations with ARPANSA stations).

---

## 8. Anti-Patterns (DO NOT)

| Don't | Do Instead | Why |
|-------|------------|-----|
| Use `GraphData` (minute-by-minute, ~840 points) | Use `TableData` (hourly, ~14 points) | 840 data points is excessive for a summary chart; hourly is sufficient and renders faster |
| Fetch ARPANSA API client-side | Fetch server-side in `+page.server.ts` | Consistent with existing pattern; avoids CORS issues on some browsers; enables caching |
| Import Chart.js globally | Import only in `UvChart.svelte` with dynamic import | Keep bundle size small; chart only loads when UV data is available |
| Create a separate API route for UV chart data | Add to existing `+page.server.ts` load function | Avoids extra round-trip; data loads with the page |
| Hardcode today's date as UTC | Use station timezone to format date | ARPANSA data is in local time; UTC midnight mismatch causes wrong day's data |
| Show chart for Hong Kong or non-AU locations | Conditionally hide with `{#if data.uvChartData}` | ARPANSA only covers Australian stations |

---

## 9. Test Case Specifications

### Unit Tests

| Test ID | Component | Input | Expected Output | Edge Cases |
|---------|-----------|-------|-----------------|------------|
| TC-001 | UvChart | Valid hourly data (14 entries) | Chart renders with 14 points, both lines visible | Empty array hides chart |
| TC-002 | UvChart | Data where Measured is "n/a" for future hours | Measured line stops at last real measurement | All "n/a" = no measured line |
| TC-003 | UvChart | Peak UV = 12.5 | Y-axis scales to 14.5, peak text shows "12.5" | Peak = 0.0 (nighttime/overcast) |
| TC-004 | WeatherTab | `uvChartData` is null | No chart section rendered | Location is Hong Kong |
| TC-005 | WeatherTab | `uvChartData` is valid | Chart section appears after 7-Day Forecast | |

### Integration Tests

| Test ID | Flow | Setup | Verification | Teardown |
|---------|------|-------|--------------|----------|
| IT-001 | Server-side UV chart fetch | Mock ARPANSA API response | `load()` returns `uvChartData` with correct structure | Clear mock |
| IT-002 | Cache behavior | Fetch once, check cache hit on second call | Second call returns cached data, no API call | Clear cache |
| IT-003 | API failure graceful degradation | Mock ARPANSA API to return 500 | `uvChartData` is null, page renders without chart | Clear mock |

---

## 10. Error Handling Matrix

| Error Type | Detection | Response | Fallback | Logging |
|------------|-----------|----------|----------|---------|
| ARPANSA API timeout | `fetchWithRetry` exhausts retries (3x, 10s timeout) | Return `uvChartData: null` | Chart section hidden; existing UV index stat card still shows from XML feed | WARN |
| ARPANSA API 4xx/5xx | Non-200 HTTP response | Return `uvChartData: null` | Chart section hidden | WARN |
| Malformed JSON response | JSON parse error | Return `uvChartData: null` | Chart section hidden | ERROR |
| Location has no ARPANSA station | `UV_CHART_COORDS[locationKey]` is undefined | Skip fetch, return `uvChartData: null` | Chart section hidden | None (expected) |
| Chart.js render error | try/catch around chart initialization | Show nothing | Chart section hidden | ERROR |

---

## 11. References

| Topic | Location | Section |
|-------|----------|---------|
| Existing UV data fetch | `homepage/src/routes/+page.server.ts` | Lines 91-126 (`fetchUVData()`) |
| UV location mapping | `homepage/src/routes/+page.server.ts` | Lines 60-64 (`UV_LOCATION_MAP`) |
| Weather tab layout | `homepage/src/routes/WeatherTab.svelte` | Full file |
| Page data flow | `homepage/src/routes/+page.svelte` | Lines 126-127 |
| Chart.js dependency | `homepage/package.json` | `chart.js@4.4.1` |
| ARPANSA API (JSON) | `https://uvdata.arpansa.gov.au/api/uvlevel/?longitude=X&latitude=Y&date=DD-MM-YYYY` | External |
| ARPANSA stations | `https://uvdata.arpansa.gov.au/api/categoriesSites` | External |
| Existing card styles | `homepage/src/routes/WeatherTab.svelte` | Lines 216-221 (`.forecast-section`) |
