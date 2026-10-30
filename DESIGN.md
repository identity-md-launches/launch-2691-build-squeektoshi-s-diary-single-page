# Implemented design system

## Overview

Squeektoshi’s Diary is a quiet, read-only observation journal for people following Squeekchain. Cream paper, dark ink, olive activity colours and an original pixel hamster carry the visual idea. The live observation comes first, followed by a date-range control and the actual diary; there is no separate marketing hero.

Canonical implementation: `src/style.css`, the semantic shell in `index.html`, and the render patterns in `src/main.ts`. The design intentionally presents rest as normal and never asks the hamster to run. Missing observations remain visibly different from quiet ones.

## Colors

The CSS uses semantic hex tokens in `src/style.css:3`. Preserve these roles when adding components.

| Token | Value | Role |
| --- | --- | --- |
| `--color-page` | `#f8f5e9` | Cream page background |
| `--color-surface` | `#fffcf3` | Main observation and diary surfaces |
| `--color-ink` | `#30372c` | Primary text and selected range control |
| `--color-muted` | `#646958` | Supporting text, data labels and captions |
| `--color-line` | `#d9dacb` | Quiet separators and entry outlines |
| `--color-outline` | `#424939` | Structural outlines and primary panel border |
| `--color-accent` | `#485f35` | Activity emphasis, progress and meaningful icons |
| `--color-accent-soft` | `#e8edda` | Soft record-icon and context backgrounds |
| `--color-scene` | `#e9edce` | Hamster illustration area |
| `--color-rest` | `#e9eadd` | Observed zero passes and empty progress track |
| `--color-heat-1` through `--color-heat-4` | `#ccd8ac`, `#9db675`, `#729449`, `#44652f` | Increasing observed passes per hour |
| `--color-warm` | `#f0dcbb` | Text-selection background |
| `--color-warning-bg` / `--color-warning-ink` | `#f6e7c9` / `#715328` | Offline/delayed-observation feedback |
| `--color-focus` | `#335f8f` | Keyboard focus perimeter |

The illustration also uses dedicated, local SVG colours for fur, cheeks, seeds and wheel spokes; these are artwork, not additional interface status colours. `#ac7746` marks the heading’s dot. There is no dark theme. The final probe measured all resolved text pairs above its required contrast threshold; see validation for measured values and scope.

## Typography

Both web fonts are local WOFF2 files in `src/assets/`, loaded by the first two declarations in `src/style.css` with `font-display: swap`. DM Sans supplies weights 400–700; the UI uses 400, 600 and 700. Fraunces supplies weight 600. Font licenses are retained with the assets. Browser inspection confirmed both faces loaded.

| Role/token | Desktop | At 1000px and below | At 440px and below |
| --- | --- | --- | --- |
| `--text-xs` | 12px | 12px | 12px |
| `--text-sm` | 14px | 14px | 14px |
| `--text-body` | 16px | 16px | 16px |
| `--text-medium` | 20px | 20px | 20px |
| `--text-heading` | 28px | 28px | 20px |
| `--text-display` | 56px | 48px | 40px |

Sizes are authored in rem against the normal 16px root. Fraunces, with Georgia/serif fallback, sets the status headline, section titles, entry totals, dates and record values. DM Sans, with sans-serif fallback, sets controls, prose and labels. There are at most six sizes per viewport and no monospace prose.

Headlines use line-height 1.08 and tracking −0.045em. Section headings use 1.25 and −0.025em. Prose uses 1.55; data values are generally 1.3. There are no tracked capital labels. Headings balance and can break unusually long text; prose uses natural wrapping. Long explanatory paragraphs are capped in measure. Live numbers, entry metrics, progress values and records use tabular numerals. Important values are never ellipsized.

## Layout

`.page-width` caps the page at 1160px. Normal side gutters are 48px, then 32px below 1000px, 20px below 760px and 16px below 440px. The spacing vocabulary is 4, 8, 12, 16, 24, 32, 48 and 64px; `--space-4` and `--space-5` directly drive shared entry/record gaps and section-heading spacing. Component-specific values such as 20px panel padding and 56px section separation remain explicit in CSS.

- Above 1000px, the live panel is two columns at 1.22:1, diary cards use two columns with today spanning both, records use four columns, and chain context uses three columns.
- At 1000px and below, the live panel remains split at 1.2:1, records use two columns, and chain links become a full-width row beneath its two statistics.
- At 760px and below, the live panel stacks. Its illustration uses a two-column mini-grid so the caption, label and art never overlap. Diary cards and chain context become one column. Record cards fit into columns with an 8rem minimum, naturally dropping to one column when text is enlarged. Nonessential in-page header links are hidden; the brand and Genesis link remain.
- At 440px and below, the main range control spans the content width, with 44px-high buttons. The first 390 × 844 screen contains the live product and range selector. The mobile illustration has a 140px minimum height.
- The heatmap keeps 24 hour columns on every viewport. Its inner chart is at least 49rem wide (784px at the standard font size); only `.heatmap-scroll` scrolls horizontally. The day-label column is 4.75rem, so it expands with text. Minor hourly labels hide on small screens while the columns and exact detail remain accessible.

The document itself had no horizontal overflow at 320, 390, 760, 1000 or 1440px in Chromium. Reflow was separately checked with 200% text enlargement at 390px. Native zoom and physical mobile browsers remain unverified.

## Elevation & Depth

Surfaces are flat: there are no box shadows, glows or elevated inner cards. One-pixel boundaries group data; the live panel uses a 1.5px structural outline. Quiet dividers separate the update line, chart detail and chain statistics. The selected range button is ink-filled with cream text. Selection and focus use outlines, never layout-changing border widths.

The scene’s small rotated label is the only sticker-like element. The illustration itself is decorative; the actual status is always written in the headline. Nothing is sticky or floats over page text.

## Shapes

`--radius-card` is 20px, `--radius-small` 10px and `--radius-pill` 100px. Major panels, diary entries and record cards share the card radius. The split scene uses 18px inner corner radii. Heat cells use 4px corners, range buttons 7px, and progress bars are fully rounded. Dashed outlines indicate missing chart observations, hatching indicates aggregate observations, and faint solid outlines identify future hours.

## Components

These are source patterns, not an exported component library.

| Pattern and source | Behavior and states |
| --- | --- |
| Brand/header, `index.html`, `.site-header` | Logo is a home anchor; semantic navigation; flex wrapping preserves enlarged text. Skip link is first in keyboard order. |
| Live observation, `renderStatus()` in `src/main.ts` | Running, resting, unknown, cached, delayed and offline states. Labels, units and written status accompany colour and animation. Absent values stay unknown. |
| Hamster scene, inline SVG in `index.html` | Crisp pixel art with rotating spokes/running bounce or breathing/sleep marks. The pause button toggles `aria-pressed`. Stale observations pause motion. Animations are opt-in under `prefers-reduced-motion: no-preference`. |
| Range control, `.range-control` | Native buttons with `aria-pressed`, clear selected fill, hover and visible keyboard focus. Controls sit above the chart. |
| Heatmap, `renderHeatmap()` / `showDetail()` | Semantic grid; one tab stop with arrow/Home/End movement. Enter/Space selects, Escape clears selection. Pointer hover, touch selection, native tooltips and inline detail all expose observations. Focus is retained across history refresh. |
| Method disclosure, `#heatmap-method` | Native `details`/`summary`; explains granularity, bounds, unknowns and settlement lag. |
| Daily entry, `renderEntries()` | Date, generated factual line, pass total, activity/stretch metrics or explicit ranges, and exact-hour coverage. Today is in progress; missing days stay unwritten. |
| Records, `getRecords()` / `.record-card` | Complete-day comparisons, directly observed stretch lower bound, observed active-day streak. No ranking asks the hamster to do more. |
| Chain context, `renderChain()` | Semantic progress bars, human-readable values, exact base-unit amount on hover, unavailable states and descriptive external links. |
| Offline feedback, `renderConnection()` / `src/api.ts` | Small polite status message and per-feed failure isolation. Cached loading is distinguished from a failed request. Last good values persist; refresh and automatic retry remain available. |

Focus is a 3px `--color-focus` outline with offset; dense chart cells use a 1px offset. Main mobile range buttons are 44px high. Dense heat cells remain 28px high and are spaced; they meet the measured minimum-target/spacing check but are smaller than the comfortable 44px size. Motion uses named properties with 120ms interaction transitions and a 0.96 press scale. Running wheel rotation is 3s, the hamster bounce 0.36s and sleep motion 3s. Reduced motion removes these animations and smooth scrolling. Forced-colour styles preserve chart boundaries and selected controls.

## Do’s and Don’ts

- Reuse `.page-width`, `.section-heading`, the existing type tokens and flat card treatment for additional content. Keep controls directly above the data they change.
- Preserve UTC labels and local-time explanations. Reuse `timeElement()` when showing a timestamp.
- Reuse the API parsers and never turn a missing field into a fabricated zero. Keep detailed and aggregate observations visibly distinct.
- Describe observed activity and healthy rest. Do not add calls to run, competitive prompts, wallets or transaction actions.
- Use an existing data/status token for its defined role. Do not add decorative gradients, shadows, additional font families or small tracked capitals.

This document follows the pinned Better Interface workflow, adapted from Jakub Krehel (MIT), and the Impeccable documentation method by Paul Bakaus (Apache-2.0). The retained license record is `LICENSES/design-guidance.txt`.
