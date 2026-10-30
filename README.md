# Squeektoshi’s Diary

A single-page, read-only diary of the hamster behind Squeekchain. Built with vanilla TypeScript, CSS and Vite; the production export is plain HTML, CSS and JavaScript.

## Run it

Use Node.js 22 or newer and npm.

```sh
npm ci
npm run dev
```

For the production site:

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

Open the preview URL printed by Vite. The ready-to-serve export is **`dist/`**, included alongside the source and `package-lock.json`. Serve that directory with any static server or pin it to IPFS. Vite uses `base: './'`; assets are relative and navigation uses page anchors, so no server rewrites are needed. The export was also tested under `/preview/` to check gateway-style subpaths.

## What it does

- Reads the wheel status every 15 seconds and the three settlement feeds plus token supply every minute. Refresh retries all five feeds immediately. Hidden tabs pause polling and refresh when visible again.
- Shows running/resting pixel animation, RPM, speed in cm/s and the wheel’s reported lifetime distance in km.
- Switches between 7-day and 30-day, 24-column heatmaps. Select an hour for the actual observation; arrow keys, Home, End, Enter and Escape also work. Small screens scroll the chart within its own container.
- Writes seven daily entries, compares completed days, records the longest directly observed hourly stretch, and counts the current observed active-day streak.
- Shows Squeek block progress and SQK minted against its cap, with links to the official status page and Genesis.
- Uses UTC throughout, with local time in time tooltips and the selected-hour detail. Motion can be paused and respects reduced-motion preferences.

No wallet, contract calls, transactions, accounts, analytics, cookies or backend. Runtime requests go only to the public API below. Fonts, favicon and the 1200 × 630 sharing image are bundled locally. Original sharing artwork is in `src/assets/social-card.svg`.

## Data and honest limits

The implementation was built against real responses from:

| Public GET endpoint | Fields used |
| --- | --- |
| `https://api.squeekchain.com/v1/status` | `measurement.coreStatus`, `rpmMilli`, `speedMmPerSecond`, `distanceMm`, `cumulativeWorkUnits`, freshness/timestamps; `builder.anchor.blockHeight` and `blockProgress` |
| `https://api.squeekchain.com/v1/settlements?range=24h` | `generatedAt`, `buckets[].startAt/endAt/workAdded/settlementCount` |
| The same endpoint with `range=7d` and `range=30d` | The same bucket fields, at their actual resolutions |
| `https://api.squeekchain.com/v1/economy/state` | `asset.decimals`; `supply.totalMintedBaseUnits`, `liveSupplyBaseUnits`, `capBaseUnits` |

**The real API does not provide 30 days of hourly data.** At validation, 24h contained hourly buckets, 7d contained six-hour buckets, and 30d contained noon-to-noon 24-hour buckets. Requests for an hourly bucket override were rejected by the API. The diary does not make up the missing hours:

- Solid cells are real hourly observations. Hatched cells share an aggregate bucket; their intensity is the bucket’s average passes per hour. The tooltip gives the exact whole-bucket total and interval, explicitly saying the hourly count is unavailable.
- Finer observations take precedence without adding overlapping feeds together. UTC-day totals use non-overlapping whole buckets; noon-to-noon totals are never attributed to one calendar day.
- Exact active-hour counts use completed hourly observations. Coarse observations give conservative ranges, explicitly labelled, within the observed completed hours. Unknown intervals are excluded. An active hour means an interval containing passes, not an hour of continuous running. Quiet wheel time does not establish physical sleep.
- Record days require complete UTC-day coverage. The longest-stretch record is a lower bound from consecutive detailed hours; grouped older data may hide a longer one. Streaks stop at an unobserved day and can continue from yesterday while today is still in progress.
- A zero-work bucket with no settlements is missing observation, not a confirmed rest. Future hours have a separate treatment. Settlement time can lag physical activity.

The exact older hourly routine, sleep duration and definitive longest continuous run cannot be recovered from these public feeds. This limitation is explained in the page’s “How to read this diary” disclosure.

## Offline behavior

Each successful response replaces only its own feed. A failed or malformed response retains that feed’s last good values, shows “Offline, showing last data,” and retries automatically. A partial outage leaves the other feeds updating. Stale wheel data uses “was” and pauses the illustration. A saved visit first says it is checking for fresh observations, rather than claiming it is already offline.

`localStorage` holds only a compact cache of the public data used by the diary. It contains no visitor identity and is never uploaded. It is not a historical archive or an offline copy of the site. Storage can be blocked or cleared; the page still works, but retention across reloads then depends on a successful API response. A first offline visit clearly says that no saved observations exist.

## Validation

The worker ran the production build, strict TypeScript check and 10 data-model regression tests successfully using the locked dependency versions. Chromium passed the browser interaction suite, including mobile filters, keyboard selection, refresh timers, malformed responses, cache/recovery, share assets, reduced motion and 200% text enlargement. No page overflow was found at 320, 390, 760, 1000 or 1440 pixels. The pinned taste probe passed **16/16** checks. The live API and actual production export were also inspected in the supplied browser.

WebKit could not launch in the available runtime and remains unverified. Physical devices, screen-reader software and browser-native 200% zoom were not tested. Text enlargement is a separate check, not a claim of native zoom testing.

See [the validation report](artifacts/validation.md) for commands, six-domain Better Interface coverage, fixes and limitations; [DESIGN.md](DESIGN.md) documents the final system. Browser evidence is in `artifacts/mobile-390.png` and `artifacts/desktop-1440.png`.

To repeat the interaction checks:

```sh
npx playwright install chromium webkit
npm run test:browser
```

The suite serves `dist/` under a subpath, uses explicitly synthetic API fixtures only inside tests, and writes results and screenshots to `test/scratch/browser/`. It closes its preview and browsers when done. A failed assertion exits nonzero; an unavailable browser engine is explicitly reported as untested. No test fixture is part of the runtime export.

## Source and size

`src/model.ts` parses API values and computes observations; `src/api.ts` handles read-only fetching, failure isolation and caching; `src/main.ts` renders the diary and wires interactions. `src/style.css` owns the design. `index.html` contains the semantic page shell and metadata. `tests/` contains the reproducible validation harnesses.

The entire delivered project is below the 8 MiB submission limit; the static export is about 201 KiB. Dependencies and package caches are not included. No ignore file was changed. Production assets need no files from the supplied reference guides or the scratch tests.

Design guidance attribution: Jakub Krehel’s Better Interface (MIT) and Paul Bakaus’s Impeccable documentation method (Apache-2.0); notices are retained in [LICENSES/design-guidance.txt](LICENSES/design-guidance.txt). Local DM Sans and Fraunces font licenses are retained in `public/assets/` and the export.
