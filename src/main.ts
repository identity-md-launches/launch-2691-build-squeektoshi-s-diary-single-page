import { state, restoreCache, refresh, type Resource } from './api';
import { HOUR, dayStart, formatNumber as num, makeDays, getRecords, tokenNumber, tokenExact, type DiaryDay, type Slot } from './model';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const dateFormat = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' });
const shortDay = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });
const longDate = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
const localTime = (time: number) => new Date(time).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
const timeElement = (time: number, label: string) => `<time datetime="${new Date(time).toISOString()}" title="Your local time: ${escapeHTML(localTime(time))}">${label}</time>`;
let range = 7;
let days: DiaryDay[] = [];
let selectedStart: number | null = null;
let hoverStart: number | null = null;
let latestPhase = '';
let motionPaused = false;
const allResources: Resource[] = ['status', '24h', '7d', '30d', 'economy'];

function escapeHTML(text: string) {
  return text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function renderStatus() {
  const telemetry = state.status;
  const phase = telemetry?.phase ?? 'unknown';
  const stale = !!telemetry && (telemetry.freshness !== 'online' || telemetry.observedAt === null || Date.now() - telemetry.observedAt > telemetry.staleAfter || state.errors.has('status'));
  const heading = $('status-heading');
  const label = $('live-label');
  if (phase === 'running') {
    heading.innerHTML = `Squeektoshi ${stale ? 'was' : 'is'}<br /><span class="state-word">running<span class="heading-dot">.</span></span>`;
    $('status-description').textContent = stale ? 'At the last observation, tiny paws were turning the wheel.' : 'Tiny paws, turning the wheel. All at his own pace.';
    label.textContent = stale ? 'Last seen on the wheel' : 'A little wheel time';
    $('scene-label').textContent = 'Going at his own pace';
    $('scene-caption').textContent = 'One little pass at a time.';
  } else if (phase === 'napping') {
    heading.innerHTML = `Squeektoshi ${stale ? 'was' : 'is'}<br /><span class="state-word">napping<span class="heading-dot">.</span></span>`;
    $('status-description').textContent = stale ? 'At the last observation, the wheel was still. Rest is part of the day.' : 'The wheel is still. A little rest is part of the day.';
    label.textContent = stale ? 'Last seen resting' : 'Taking a little rest';
    $('scene-label').textContent = 'Do not disturb';
    $('scene-caption').textContent = 'Nothing urgent. Just a little snooze.';
  } else {
    heading.innerHTML = 'Checking in on<br />Squeektoshi<span class="heading-dot">.</span>';
    $('status-description').textContent = state.loading ? 'A little window into the hamster behind Squeekchain.' : 'No wheel observation yet. Try refreshing in a moment.';
    label.textContent = state.loading ? 'Checking in' : 'Wheel status unavailable';
    $('scene-label').textContent = 'A moment in his day';
    $('scene-caption').textContent = 'His wheel. His pace.';
  }
  $('hamster-scene').dataset.phase = phase;
  $('hamster-scene').classList.toggle('is-stale', stale);
  $('hamster-title').textContent = phase === 'running' ? 'Squeektoshi runs in his wheel' : phase === 'napping' ? 'Squeektoshi rests beside his still wheel' : 'Squeektoshi, a tiny pixel hamster beside his wheel';
  $('status-dot').dataset.phase = phase;
  $('rpm').textContent = num(telemetry?.rpm ?? null, 1);
  $('speed').textContent = num(telemetry?.speed ?? null, 1);
  $('distance').textContent = num(telemetry?.distance ?? null, 2);
  if (telemetry?.passes !== null && telemetry?.passes !== undefined) $('distance').title = `${num(telemetry.passes)} total wheel passes. Distance is reported directly by the wheel.`;
  const observed = telemetry?.observedAt;
  $('update-info').innerHTML = observed ? `${stale ? 'Last observed' : 'Observed'} ${timeElement(observed, `${timeFormat.format(observed)} UTC`)} · every 15s` : 'Live wheel data · refreshes every 15s';
  if (phase !== latestPhase && !state.loading) {
    $('announcements').textContent = phase === 'unknown' ? 'Wheel status unavailable.' : `Squeektoshi ${stale ? 'was' : 'is'} ${phase}.`;
    latestPhase = phase;
  }
  renderConnection(stale);
  renderChain();
}

function renderConnection(stale: boolean) {
  const badge = $('offline-badge');
  const hasData = allResources.some(r => state[r] !== null);
  const errors = state.errors.size > 0;
  badge.hidden = !errors && !stale;
  const message = state.loading && errors && hasData ? 'Checking for fresh data · showing saved observations' : errors ? hasData ? 'Offline, showing last data · retries automatically' : 'Offline · no saved data yet. Use refresh to retry.' : stale ? 'Wheel telemetry is delayed · showing last observation' : '';
  if (badge.textContent !== message) badge.textContent = message;
  badge.title = state.loading && errors ? 'Checking cached public observations against the API.' : errors ? `Unavailable: ${[...state.errors].map(r => r === 'status' ? 'wheel telemetry' : r === 'economy' ? 'token supply' : `${r} history`).join(', ')}. Other available feeds continue to update.` : '';
}

function bucketDescription(slot: Slot): string {
  const day = `${dateFormat.format(slot.start)}, ${timeFormat.format(slot.start)} UTC`;
  if (slot.future) return `${day} · This hour hasn’t happened yet.`;
  if (!slot.observed || !slot.bucket) return `${day} · No recorded observation. This is not a confirmed quiet hour.`;
  const b = slot.bucket;
  if (slot.exact) return `${day} · ${num(b.work)} passes${b.work === 0 ? ' · A quiet hour on the wheel.' : ' · A little wheel time.'}${slot.start + HOUR > Date.now() ? ' · Hour in progress.' : ''}`;
  return `${day} · Part of a ${(b.end - b.start) / HOUR}-hour bucket with ${num(b.work)} passes total. Exact hourly count unavailable.`;
}

function renderHeatmap() {
  const now = Date.now();
  days = makeDays([state['24h'], state['7d'], state['30d']].filter(h => h !== null), range, now);
  $('heatmap-range').innerHTML = `${timeElement(days[0].start, dateFormat.format(days[0].start))} <span aria-hidden="true">–</span> ${timeElement(days.at(-1)!.start, dateFormat.format(days.at(-1)!.start))}`;
  const heatmap = $('heatmap');
  const previousFocus = heatmap.contains(document.activeElement) ? Number((document.activeElement as HTMLElement).dataset.start) : null;
  const initial = selectedStart ?? dayStart(now) + Math.max(0, new Date(now).getUTCHours() - 1) * HOUR;
  heatmap.setAttribute('aria-rowcount', String(range + 1));
  heatmap.setAttribute('aria-colcount', '25');
  const header = `<div class="heatmap-row hour-labels" role="row"><span role="columnheader" class="day-column">Day</span>${Array.from({ length: 24 }, (_, h) => `<span role="columnheader" class="hour-label ${h % 3 ? 'minor-hour' : ''}" title="${String(h).padStart(2, '0')}:00 UTC">${String(h).padStart(2, '0')}</span>`).join('')}</div>`;
  const content = days.map(d => `<div class="heatmap-row" role="row"><span role="rowheader" class="day-column ${d.today ? 'is-today' : ''}" title="${escapeHTML(longDate.format(d.start))}. Your local midnight: ${escapeHTML(localTime(d.start))}"><span class="day-name">${d.today ? 'Today' : range === 7 ? shortDay.format(d.start) : dateFormat.format(d.start)}</span>${range === 7 ? `<span class="day-date">${dateFormat.format(d.start)}</span>` : ''}</span>${d.slots.map(s => `<button type="button" role="gridcell" class="heat-cell${!s.exact && s.observed ? ' is-grouped' : ''}${!s.observed && !s.future ? ' is-missing' : ''}${s.future ? ' is-future' : ''}" data-start="${s.start}" data-level="${s.level}" tabindex="${s.start === initial ? '0' : '-1'}" aria-selected="${selectedStart === s.start}" aria-label="${escapeHTML(bucketDescription(s))}" title="${escapeHTML(bucketDescription(s))}\nYour local time: ${escapeHTML(localTime(s.start))}"></button>`).join('')}</div>`).join('');
  heatmap.innerHTML = header + content;
  if (!heatmap.querySelector('[tabindex="0"]')) heatmap.querySelector<HTMLButtonElement>('.heat-cell')!.tabIndex = 0;
  if (previousFocus !== null) heatmap.querySelector<HTMLButtonElement>(`[data-start="${previousFocus}"]`)?.focus({ preventScroll: true });
  if (selectedStart !== null) showDetail(selectedStart);
}

function showDetail(start: number | null) {
  const slot = days.flatMap(d => d.slots).find(s => s.start === start);
  if (!slot) return;
  const description = bucketDescription(slot);
  let extra = '';
  if (slot.bucket && !slot.exact) {
    const b = slot.bucket;
    extra = `Bucket: ${dateFormat.format(b.start)} ${timeFormat.format(b.start)} – ${dateFormat.format(b.end)} ${timeFormat.format(b.end)} UTC. ${num(b.settlements)} settlements.`;
  }
  $('cell-detail').innerHTML = `<span class="detail-icon" aria-hidden="true">${slot.observed ? '◷' : '○'}</span><p><strong>${escapeHTML(description)}</strong>${extra ? `<span>${escapeHTML(extra)}</span>` : ''}<span>Your local time: ${escapeHTML(localTime(slot.start))}</span></p>`;
}

function renderEntries() {
  const week = makeDays([state['24h'], state['7d'], state['30d']].filter(h => h !== null), 7, Date.now());
  $('daily-entries').setAttribute('aria-busy', String(state.loading));
  $('daily-entries').innerHTML = [...week].reverse().map((d, index) => {
    const label = d.today ? 'Today' : weekday.format(d.start);
    const anyData = d.slots.some(s => s.observed);
    const totalLabel = d.total !== null ? `${num(d.total)} passes${d.today ? ' so far' : ''}` : d.knownTotal > 0 ? `${num(d.knownTotal)} known passes` : anyData ? 'A partly recorded day' : state.loading ? 'Opening this chapter…' : 'A page still unwritten';
    let line = !anyData ? 'No recorded observations for this day. A blank page doesn’t mean a quiet wheel.' : d.total === 0 ? 'A quiet wheel in the recorded hours. Rest is part of the rhythm.' : 'A few tiny footsteps in the story of the chain.';
    if (d.busiest) {
      const b = d.busiest;
      line = b.end - b.start === HOUR ? `Busiest observed hour: ${timeElement(b.start, `${timeFormat.format(b.start)} UTC`)}${d.quietHours !== null ? `, with ${d.quietHours} quiet ${d.quietHours === 1 ? 'hour' : 'hours'} in completed observations` : '. Earlier hours are grouped'}.` : `Busiest observed bucket: ${timeElement(b.start, timeFormat.format(b.start))}–${timeElement(b.end, `${timeFormat.format(b.end)} UTC`)}. Exact hourly counts aren’t available.`;
    }
    const rangeText = (v: [number, number] | null) => v === null ? 'Unavailable' : `${v[0] === v[1] ? v[0] : `${v[0]}–${v[1]}`} h`;
    const boundsHint = 'Bounds within observed, completed hours. A positive grouped bucket implies some activity, not that every hour was active. Missing hours are excluded.';
    return `<article class="entry-card ${index === 0 ? 'entry-today' : ''}"><time class="entry-date" datetime="${new Date(d.start).toISOString()}" title="UTC day starts at ${escapeHTML(localTime(d.start))} in your local time"><span class="entry-day-number">${new Date(d.start).getUTCDate()}</span><span>${new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(d.start)}</span></time><div class="entry-body"><div class="entry-title-row"><h3>${label}</h3>${d.today ? '<span class="in-progress">In progress</span>' : ''}</div><p class="entry-total">${totalLabel}</p><p class="entry-line">${line}</p><dl class="entry-metrics"><div><dt>Active hours${d.activeHours === null && d.activeRange ? ' (range)' : ''}</dt><dd title="${boundsHint}">${d.activeHours === null ? rangeText(d.activeRange) : `${d.activeHours} h`}</dd></div><div><dt>Longest stretch${d.longest === null && d.stretchRange ? ' (range)' : ''}</dt><dd title="${boundsHint}">${d.longest === null ? rangeText(d.stretchRange) : `${d.longest} h`}</dd></div><div><dt>Hourly detail</dt><dd>${d.exactHours} / ${d.today ? Math.floor((Date.now() - d.start) / HOUR) : 24} h</dd></div></dl></div><span class="entry-mood" aria-hidden="true">${d.total === 0 ? '☾' : d.busiest ? '✳' : '○'}</span></article>`;
  }).join('');
  const records = getRecords(week);
  const dateLabel = (d: DiaryDay) => timeElement(d.start, dateFormat.format(d.start));
  $('records').innerHTML = [
    { icon: '✳', label: 'Most wheel passes', value: records.best ? num(records.best.total) : 'Not yet known', unit: records.best ? 'passes' : '', detail: records.best ? `${dateLabel(records.best)} · completed day` : 'Needs a fully recorded day' },
    { icon: '↔', label: 'Longest observed stretch', value: records.longest ? `≥ ${records.longest}` : 'Not yet known', unit: records.longest ? 'h' : '', detail: records.longestAt ? `${timeElement(records.longestAt, `${dateFormat.format(records.longestAt)} ${timeFormat.format(records.longestAt)} UTC`)} · hourly observations` : 'Needs consecutive active hours' },
    { icon: '☾', label: 'Quietest recorded day', value: records.quietest ? num(records.quietest.total) : 'Not yet known', unit: records.quietest ? 'passes' : '', detail: records.quietest ? `${dateLabel(records.quietest)} · completed day` : 'Missing data isn’t counted as rest' },
    { icon: '⚑', label: 'Current active-day streak', value: records.streak ? String(records.streak) : 'No streak recorded', unit: records.streak ? records.streak === 1 ? 'day' : 'days' : '', detail: `${records.streak === 7 ? 'At least 7 days · ' : ''}Rest days are good days, too` },
  ].map(r => `<div class="record-card"><span class="record-icon" aria-hidden="true">${r.icon}</span><h3>${r.label}</h3><p class="record-value">${r.value}${r.unit ? `<span>${r.unit}</span>` : ''}</p><p class="record-detail">${r.detail}</p></div>`).join('');
}

function renderChain() {
  const s = state.status, e = state.economy;
  $('block-height').textContent = s?.height !== null && s?.height !== undefined ? `#${num(s.height)}` : 'Awaiting data';
  const progress = s?.progress ?? null;
  $('block-percent').textContent = progress === null ? 'Unavailable' : `${num(progress, 1)}%`;
  const blockBar = $<HTMLProgressElement>('block-progress');
  blockBar.value = progress ?? 0;
  blockBar.setAttribute('aria-valuetext', progress === null ? 'Progress unavailable' : `${num(progress, 1)}%`);
  const minted = e ? tokenNumber(e.minted, e.decimals) : null, cap = e ? tokenNumber(e.cap, e.decimals) : null;
  $('sqk-minted').textContent = minted === null ? 'Awaiting data' : `${num(minted, 2)} SQK`;
  $('sqk-minted').title = e ? `Exact minted: ${tokenExact(e.minted, e.decimals)} SQK. Live supply: ${tokenExact(e.live, e.decimals)} SQK.` : '';
  $('sqk-cap').textContent = cap === null ? 'Supply cap unavailable' : `of ${num(cap)} SQK cap`;
  const mintedPercent = minted !== null && cap !== null && cap > 0 ? Math.min(100, minted / cap * 100) : null;
  $('sqk-percent').textContent = mintedPercent === null ? 'Unavailable' : `${num(mintedPercent, 2)}%`;
  const sqkBar = $<HTMLProgressElement>('sqk-progress');
  sqkBar.value = mintedPercent ?? 0;
  sqkBar.setAttribute('aria-valuetext', mintedPercent === null ? 'Minted supply unavailable' : `${num(mintedPercent, 2)}% minted`);
}

function render(changed: Resource[]) {
  renderStatus();
  if (changed.some(r => r === '24h' || r === '7d' || r === '30d')) { renderHeatmap(); renderEntries(); }
}

document.querySelectorAll<HTMLButtonElement>('[data-range]').forEach(button => button.addEventListener('click', () => {
  range = Number(button.dataset.range);
  selectedStart = null;
  document.querySelectorAll('[data-range]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  renderHeatmap();
  $('cell-detail').innerHTML = '<span class="detail-icon" aria-hidden="true">↖</span><p>Select an hour for its exact observation.</p>';
}));

$('heatmap').addEventListener('click', event => {
  const cell = (event.target as HTMLElement).closest<HTMLButtonElement>('.heat-cell');
  if (!cell) return;
  selectedStart = Number(cell.dataset.start);
  $('heatmap').querySelectorAll<HTMLButtonElement>('.heat-cell').forEach(b => { b.setAttribute('aria-selected', String(b === cell)); b.tabIndex = b === cell ? 0 : -1; });
  showDetail(selectedStart);
});
$('heatmap').addEventListener('pointerover', event => {
  const cell = (event.target as HTMLElement).closest<HTMLButtonElement>('.heat-cell');
  if (!cell) return;
  hoverStart = Number(cell.dataset.start);
  showDetail(hoverStart);
});
$('heatmap').addEventListener('pointerleave', () => { hoverStart = null; if (selectedStart !== null) showDetail(selectedStart); });
$('heatmap').addEventListener('focusin', event => {
  const cell = (event.target as HTMLElement).closest<HTMLButtonElement>('.heat-cell');
  if (cell) showDetail(Number(cell.dataset.start));
});
$('heatmap').addEventListener('keydown', event => {
  const cell = (event.target as HTMLElement).closest<HTMLButtonElement>('.heat-cell');
  if (!cell) return;
  const cells = [...$('heatmap').querySelectorAll<HTMLButtonElement>('.heat-cell')];
  const index = cells.indexOf(cell);
  const movement: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 24, ArrowUp: -24, Home: -(index % 24), End: 23 - index % 24 };
  if (event.key === 'Escape') { selectedStart = null; cells.forEach(b => b.setAttribute('aria-selected', 'false')); return; }
  if (event.key in movement) {
    event.preventDefault();
    const next = cells[Math.max(0, Math.min(cells.length - 1, index + movement[event.key]))];
    cell.tabIndex = -1; next.tabIndex = 0; next.focus();
  }
});

$('motion-toggle').addEventListener('click', () => {
  motionPaused = !motionPaused;
  $('hamster-scene').classList.toggle('motion-paused', motionPaused);
  $('motion-toggle').setAttribute('aria-pressed', String(motionPaused));
  $('motion-toggle').setAttribute('aria-label', motionPaused ? 'Resume hamster animation' : 'Pause hamster animation');
  $('motion-toggle').title = motionPaused ? 'Resume hamster animation' : 'Pause hamster animation';
  $('motion-toggle').innerHTML = `<span aria-hidden="true">${motionPaused ? '▷' : 'Ⅱ'}</span>`;
});
$('refresh').addEventListener('click', async () => {
  const button = $<HTMLButtonElement>('refresh');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  await refresh(allResources, render);
  button.disabled = false;
  button.removeAttribute('aria-busy');
  $('announcements').textContent = state.errors.size ? 'Some observations are unavailable. Keeping the last good data and retrying automatically.' : 'Diary data refreshed.';
});

function setTodayDate() {
  const now = Date.now();
  $('today-date').textContent = `${longDate.format(now)} · UTC`;
  $('today-date').setAttribute('datetime', new Date(now).toISOString());
  $('today-date').title = `Your local time: ${localTime(now)}`;
}
restoreCache();
setTodayDate();
render(allResources);
void refresh(allResources, render);
window.setInterval(() => { if (!document.hidden) { setTodayDate(); renderStatus(); void refresh(['status'], render); } }, 15_000);
window.setInterval(() => { if (!document.hidden) void refresh(['24h', '7d', '30d', 'economy'], render); }, 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { setTodayDate(); void refresh(allResources, render); } });
window.addEventListener('online', () => { void refresh(allResources, render); });
