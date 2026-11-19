// =====================================================================
// sortThings – tri assisté (insertion multi-jalons) + tier list
// =====================================================================

const $ = id => document.getElementById(id);

// --- DOM refs ---
const startSection = $("startSection");
const configSection = $("configSection");
const choiceSection = $("choiceSection");
const resultSection = $("resultSection");
const anchorContainer = $("anchorContainer");
const inputEl = $("input");

// --- State ---
let startingArray = [];       // items still to place (processed from the end)
let destinationArray = [];    // sorted slots, best first
let skippedItems = [];        // items the user chose to set aside
let currentEvaluatedChoice;
let searchLo, searchHi;       // bounds as indices in destinationArray; -1 = before all
let k = 7;                    // number of anchors shown simultaneously
let numberBattles = 0;
let startingNumberToSort = 0;
let history = [];             // undo snapshots
let phase = 'input';          // input | config | sorting | bucketing | result
let mode = 'tiers';           // tiers (quick tier list) | full (complete ranking)
let buckets = [];             // bucketing phase: one array of slots per tier
let resultItems = [];         // final flat list of slots (tier by tier)
let tierEnds = null;          // cumulative end index of each tier in resultItems (exclusive)
let tierSorted = [];          // is the order inside each tier meaningful?
let refineQueue = [];         // tiers still to sort in "refine" runs
let refineTier = null;        // tier currently being sorted, or null

const SECONDS_PER_CLICK = 4;
const SECONDS_PER_BUCKET_CLICK = 2;
const STORAGE_KEY = 'sortThings.session.v1';

const TIERS = [
    { label: 'S', color: '#ff7f7f', share: 0.07 },
    { label: 'A', color: '#ffbf7f', share: 0.18 },
    { label: 'B', color: '#ffdf7f', share: 0.25 },
    { label: 'C', color: '#ffff7f', share: 0.25 },
    { label: 'D', color: '#bfff7f', share: 0.15 },
    { label: 'F', color: '#7fff7f', share: 0.10 },
];

const TIER_KEYS = TIERS.map(t => t.label.toLowerCase());
function TIERS_FALSE() { return TIERS.map(() => false); }

// --- Utilities ---
function escapeHtml(text) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(String(text)));
    return div.innerHTML;
}

function escapeAttr(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Returns null for anything that isn't an http/https URL (blocks javascript: etc.)
function safeImageUrl(url) {
    if (typeof url !== 'string') return null;
    const t = url.trim();
    if (t.startsWith('https://') || t.startsWith('http://')) return t;
    return null;
}

function itemLabel(item) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) return item.value;
    return String(item);
}

function itemDisplay(slot) {
    if (Array.isArray(slot)) return slot.map(itemLabel).join(' / ');
    return itemLabel(slot);
}

// Returns the first image URL from a slot or raw item, or null.
function slotImage(slotOrItem) {
    const items = Array.isArray(slotOrItem) ? slotOrItem : [slotOrItem];
    for (const item of items) {
        if (item !== null && typeof item === 'object' && !Array.isArray(item) && item.image)
            return safeImageUrl(item.image);
    }
    return null;
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

// Tiny DOM builder (avoids innerHTML and inline styles, which the CSP forbids).
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function formatDuration(seconds) {
    const m = Math.round(seconds / 60);
    if (m < 1) return '< 1 min';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return `${h} h ${String(m % 60).padStart(2, '0')}`;
}

async function writeToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
    }
}

function flashButton(button, text) {
    const original = button.dataset.label || button.textContent;
    button.dataset.label = original;
    button.textContent = text;
    clearTimeout(button._flashTimer);
    button._flashTimer = setTimeout(() => { button.textContent = original; }, 1500);
}

// --- Interaction estimates ---
// With k anchors shown, branching factor is k+1 (k+1 gaps to click).
// Inserting into sorted array of size i costs ceil(log_{k+1}(i+1)) interactions.
function estimateTotalInteractions(n, anchors) {
    if (n <= 1) return 0;
    const base = anchors + 1;
    let total = 0;
    for (let i = 1; i < n; i++) {
        total += Math.ceil(Math.log(i + 1) / Math.log(base));
    }
    return total;
}

function estimateRemainingInteractions() {
    if (startingArray.length === 0) return 0;
    const base = k + 1;
    let remaining = 0;
    for (let i = 0; i < startingArray.length; i++) {
        remaining += Math.ceil(Math.log(destinationArray.length + i + 1) / Math.log(base));
    }
    return remaining;
}

// Smallest k that gets under 100 clicks if possible; otherwise the smallest k
// within 25% of the best achievable (more anchors per screen is harder to scan).
function findRecommendedK(n) {
    for (let kk = 1; kk <= 20; kk++) {
        if (estimateTotalInteractions(n, kk) <= 100) return kk;
    }
    const best = estimateTotalInteractions(n, 20);
    for (let kk = 1; kk <= 20; kk++) {
        if (estimateTotalInteractions(n, kk) <= best * 1.25) return kk;
    }
    return 20;
}

// --- Input parsing ---
// Accepts either a JSON array (strings, {value,image} objects, or nested arrays
// of those) or a newline-separated list. Falls back to newline parsing if JSON
// parsing fails or the parsed value is not an array.
function normalizeItem(item) {
    if (item !== null && typeof item === 'object' && !Array.isArray(item) && 'value' in item) {
        const v = String(item.value).trim();
        if (v === '') return null;
        const img = typeof item.image === 'string' ? item.image.trim() : '';
        return img ? { value: v, image: img } : v;
    }
    const s = String(item).trim();
    return s === '' ? null : s;
}

function parseInputList(raw) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed
                    .map(item => {
                        if (Array.isArray(item)) {
                            const group = item.map(normalizeItem).filter(x => x !== null);
                            return group.length ? group : null;
                        }
                        return normalizeItem(item);
                    })
                    .filter(x => x !== null);
            }
        } catch (_) {
            // fall through to newline parsing
        }
    }
    return raw.split('\n').map(t => t.trim()).filter(t => t !== '');
}

function updateInputInfo() {
    const list = parseInputList(inputEl.value);
    const info = $("inputInfo");
    if (list.length === 0) {
        info.textContent = 'Colle ta liste, ou importe un fichier .json / .txt.';
    } else {
        const withImg = list.filter(slotImage).length;
        info.textContent = `${list.length} élément${list.length > 1 ? 's' : ''} détecté${list.length > 1 ? 's' : ''}` +
            (withImg ? ` · ${withImg} avec image` : '') +
            (list.length < 2 ? ' (il en faut au moins 2)' : '');
    }
    $("startButton").disabled = list.length < 2;
}

// --- Persistence (localStorage, best effort) ---
function saveSession() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            v: 2, phase, mode, k, numberBattles, startingNumberToSort, startingArray, destinationArray,
            skippedItems, current: currentEvaluatedChoice ?? null, lo: searchLo, hi: searchHi,
            buckets, resultItems, tierEnds, tierSorted, refineQueue, refineTier, savedAt: Date.now(),
        }));
    } catch (_) { /* storage unavailable or full */ }
}

function clearSession() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { }
}

function readSession() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (!s || s.v !== 2 || !Array.isArray(s.destinationArray) || !Array.isArray(s.startingArray)) return null;
        if (!['sorting', 'bucketing', 'result'].includes(s.phase)) return null;
        return s;
    } catch (_) { return null; }
}

function checkResume() {
    const s = readSession();
    if (!s) { hide($("resumeBanner")); return; }
    $("resumeInfo").textContent = s.phase === 'result'
        ? `Tier list terminée : ${s.resultItems.length} éléments.`
        : `${s.startingArray.length + 1} élément(s) restant(s) à placer, ${s.numberBattles} clics effectués.`;
    show($("resumeBanner"));
}

function resumeSession() {
    const s = readSession();
    if (!s) return;
    startingArray = s.startingArray;
    destinationArray = s.destinationArray;
    skippedItems = Array.isArray(s.skippedItems) ? s.skippedItems : [];
    currentEvaluatedChoice = s.current;
    searchLo = s.lo; searchHi = s.hi;
    k = s.k; mode = s.mode; numberBattles = s.numberBattles; startingNumberToSort = s.startingNumberToSort;
    buckets = Array.isArray(s.buckets) ? s.buckets : TIERS.map(() => []);
    resultItems = Array.isArray(s.resultItems) ? s.resultItems : [];
    tierEnds = Array.isArray(s.tierEnds) ? s.tierEnds : null;
    tierSorted = Array.isArray(s.tierSorted) ? s.tierSorted : TIERS_FALSE();
    refineQueue = Array.isArray(s.refineQueue) ? s.refineQueue : [];
    refineTier = s.refineTier ?? null;
    history = [];
    hide(startSection);
    if (s.phase === 'result' || currentEvaluatedChoice == null) {
        showResult();
    } else {
        phase = s.phase;
        show(choiceSection);
        renderCurrent();
        renderChoice();
    }
}

// --- Start flow ---
function start() {
    startingArray = parseInputList(inputEl.value);
    if (startingArray.length < 2) return;
    startingNumberToSort = startingArray.length;
    hide(startSection);
    showConfigScreen();
}

function showConfigScreen() {
    phase = 'config';
    show(configSection);
    $('configItemCount').textContent = startingNumberToSort;

    $('configBaselineEstimate').textContent = estimateTotalInteractions(startingNumberToSort, 1);
    const rec = findRecommendedK(startingNumberToSort);
    $('configRecommendedK').textContent = rec;
    $('configRecommendedEstimate').textContent = estimateTotalInteractions(startingNumberToSort, rec);

    $('configKInput').value = rec;
    $('modeTiersClicks').textContent = startingNumberToSort;
    $('modeTiersTime').textContent = formatDuration(startingNumberToSort * SECONDS_PER_BUCKET_CLICK);
    const big = startingNumberToSort > 80;
    document.querySelector('input[name="sortMode"][value="' + (big ? 'tiers' : 'full') + '"]').checked = true;
    updateConfigEstimate();
}

function selectedMode() {
    const r = document.querySelector('input[name="sortMode"]:checked');
    return r ? r.value : 'tiers';
}

function readConfigK() {
    const raw = parseInt($('configKInput').value);
    return isNaN(raw) ? 7 : Math.max(1, Math.min(20, raw));
}

function updateConfigEstimate() {
    const kk = readConfigK();
    const est = estimateTotalInteractions(startingNumberToSort, kk);
    $('configKValue').textContent = kk;
    $('configCustomEstimate').textContent = est;
    $('configCustomTime').textContent = formatDuration(est * SECONDS_PER_CLICK);
    $('modeFullClicks').textContent = est;
    $('modeFullTime').textContent = formatDuration(est * SECONDS_PER_CLICK);
    $('fullOptions').classList.toggle('hidden', selectedMode() !== 'full');
}

function backToInput() {
    hide(configSection);
    show(startSection);
    phase = 'input';
    checkResume();
}

function validateConfig() {
    mode = selectedMode();
    k = mode === 'full' ? readConfigK() : 7;
    hide(configSection);
    if (mode === 'full') initializeSorting(); else initializeBucketing();
}

function toSlot(item) {
    return Array.isArray(item) ? item : [item];
}

// --- Sorting ---
function resetRunState() {
    numberBattles = 0;
    history = [];
    skippedItems = [];
    tierEnds = null;
    resultItems = [];
    tierSorted = TIERS_FALSE();
    refineQueue = [];
    refineTier = null;
}

// Full ranking: insertion sort over the whole list.
function initializeSorting() {
    resetRunState();
    destinationArray = [toSlot(startingArray.pop())];
    phase = 'sorting';
    show(choiceSection);
    nextItem();
}

// Quick tier list: one click per item to pick its tier.
function initializeBucketing(keepExisting = false) {
    if (!keepExisting) resetRunState();
    buckets = TIERS.map((_, i) => keepExisting && tierEnds
        ? resultItems.slice(i === 0 ? 0 : tierEnds[i - 1], tierEnds[i])
        : []);
    startingArray = startingArray.map(toSlot).reverse();
    startingNumberToSort = startingArray.length;
    phase = 'bucketing';
    show(choiceSection);
    nextItem();
}

function nextItem() {
    if (startingArray.length === 0) {
        finishRun();
        return;
    }
    currentEvaluatedChoice = startingArray.pop();
    searchLo = -1;
    searchHi = destinationArray.length;
    renderCurrent();
    renderChoice();
}

function renderChoice() {
    updateChoiceChrome();
    if (phase === 'bucketing') renderBuckets(); else renderAnchors();
}

// Texts / visibility that depend on the current kind of run.
function updateChoiceChrome() {
    const bucketing = phase === 'bucketing';
    $('ladderHint').innerHTML = bucketing
        ? 'Dans quel tier range-t-on cet élément ? Raccourcis : <kbd>S</kbd> <kbd>A</kbd> <kbd>B</kbd> <kbd>C</kbd> <kbd>D</kbd> <kbd>F</kbd> ou <kbd>1</kbd>–<kbd>6</kbd>.'
        : 'Clique sur l\'emplacement où cet élément se range. Raccourcis : touches <kbd>1</kbd>–<kbd>9</kbd>.';
    $('skipButton').classList.toggle('hidden', refineTier !== null);
    const ctx = $('runContext');
    if (refineTier !== null) {
        ctx.textContent = `Tri à l'intérieur du tier ${TIERS[refineTier].label}`;
        show(ctx);
    } else {
        hide(ctx);
    }
}

function renderCurrent() {
    $('currentItemDisplay').textContent = itemDisplay(currentEvaluatedChoice);
    const imgEl = $('currentItemImage');
    const imgUrl = slotImage(currentEvaluatedChoice);
    if (imgUrl) {
        imgEl.onerror = () => hide(imgEl);
        imgEl.src = imgUrl;
        imgEl.alt = itemDisplay(currentEvaluatedChoice);
        show(imgEl);
    } else {
        imgEl.removeAttribute('src');
        hide(imgEl);
    }
}

// Returns indices in destinationArray to use as anchors for the current search window.
function getAnchorIndices() {
    const lo = searchLo + 1;
    const hi = searchHi - 1;
    const count = hi - lo + 1;
    if (count <= 0) return [];

    const numAnchors = Math.min(k, count);
    if (numAnchors === count) return Array.from({ length: count }, (_, i) => lo + i);
    // Spread the anchors so the numAnchors+1 gaps hold about the same number of
    // candidate positions: each click then shrinks the window by ~(k+1).
    const perGap = (count - numAnchors) / (numAnchors + 1);
    return Array.from({ length: numAnchors }, (_, j) =>
        lo + Math.round((j + 1) * perGap) + j
    );
}

function gapKeyLabel(i) {
    if (i < 9) return String(i + 1);
    if (i === 9) return '0';
    return '';
}

function makeGapButton(i, anchorIndices) {
    const last = anchorIndices.length;
    let label;
    if (i === 0) label = `↑ Meilleur que #${anchorIndices[0] + 1}`;
    else if (i === last) label = `↓ Moins bon que #${anchorIndices[last - 1] + 1}`;
    else label = `Entre #${anchorIndices[i - 1] + 1} et #${anchorIndices[i] + 1}`;

    const btn = el('button', 'gap-bar');
    btn.type = 'button';
    btn.dataset.gap = i;
    btn.appendChild(el('span', '', 'Placer ici · ' + label));
    const key = gapKeyLabel(i);
    if (key) btn.appendChild(el('kbd', '', key));
    btn.addEventListener('click', () => handleGapClick(i, anchorIndices));
    return btn;
}

function makeAnchorCard(idx) {
    const slot = destinationArray[idx];
    const card = el('div', 'anchor-card');
    card.appendChild(el('span', 'anchor-rank', '#' + (idx + 1)));
    const imgUrl = slotImage(slot);
    if (imgUrl) {
        const img = el('img', 'anchor-thumb');
        img.onerror = () => img.remove();
        img.src = imgUrl;
        img.alt = '';
        card.appendChild(img);
    }
    card.appendChild(el('span', 'anchor-name', itemDisplay(slot)));
    card.title = itemDisplay(slot);
    return card;
}

function renderAnchors() {
    const anchorIndices = getAnchorIndices();
    if (anchorIndices.length === 0) {
        insertCurrent(searchLo + 1);
        return;
    }

    const frag = document.createDocumentFragment();
    frag.appendChild(el('div', 'ladder-end', 'Meilleur'));
    for (let i = 0; i <= anchorIndices.length; i++) {
        frag.appendChild(makeGapButton(i, anchorIndices));
        if (i < anchorIndices.length) frag.appendChild(makeAnchorCard(anchorIndices[i]));
    }
    frag.appendChild(el('div', 'ladder-end', 'Moins bon'));
    anchorContainer.replaceChildren(frag);

    updateProgress();
    saveSession();
}

function renderBuckets() {
    const frag = document.createDocumentFragment();
    TIERS.forEach((tier, i) => {
        const btn = el('button', 'bucket-btn');
        btn.type = 'button';
        btn.dataset.tier = i;
        btn.style.background = tier.color;
        btn.appendChild(el('span', 'bucket-letter', tier.label));
        btn.appendChild(el('span', 'bucket-count', `${buckets[i].length} élément${buckets[i].length > 1 ? 's' : ''}`));
        btn.appendChild(el('kbd', '', tier.label));
        btn.addEventListener('click', () => bucketClick(i));
        frag.appendChild(btn);
    });
    anchorContainer.replaceChildren(frag);
    updateProgress();
    saveSession();
}

function bucketClick(tierIndex) {
    pushSnapshot();
    numberBattles++;
    buckets[tierIndex].push(toSlot(currentEvaluatedChoice));
    tierSorted[tierIndex] = false;
    nextItem();
}

function pushSnapshot() {
    history.push({
        phase, refineTier,
        starting: startingArray.slice(),
        dest: destinationArray.slice(),
        skipped: skippedItems.slice(),
        buckets: buckets.map(b => b.slice()),
        resultItems: resultItems.slice(),
        tierEnds: tierEnds ? tierEnds.slice() : null,
        tierSorted: tierSorted.slice(),
        refineQueue: refineQueue.slice(),
        current: currentEvaluatedChoice,
        lo: searchLo, hi: searchHi, battles: numberBattles,
    });
    if (history.length > 1000) history.shift();
}

function handleGapClick(gapIndex, anchorIndices) {
    pushSnapshot();
    numberBattles++;

    if (gapIndex === 0) {
        searchHi = anchorIndices[0];
    } else if (gapIndex === anchorIndices.length) {
        searchLo = anchorIndices[anchorIndices.length - 1];
    } else {
        searchLo = anchorIndices[gapIndex - 1];
        searchHi = anchorIndices[gapIndex];
    }

    if (searchHi - searchLo - 1 <= 0) {
        insertCurrent(searchLo + 1);
    } else {
        renderAnchors();
    }
}

function insertCurrent(position) {
    destinationArray.splice(position, 0, toSlot(currentEvaluatedChoice));
    nextItem();
}

function skipCurrent() {
    if (phase !== 'sorting' && phase !== 'bucketing') return;
    pushSnapshot();
    skippedItems.push(currentEvaluatedChoice);
    nextItem();
}

function undo() {
    const s = history.pop();
    if (!s) return;
    startingArray = s.starting;
    destinationArray = s.dest;
    skippedItems = s.skipped;
    buckets = s.buckets;
    resultItems = s.resultItems;
    tierEnds = s.tierEnds;
    tierSorted = s.tierSorted;
    refineQueue = s.refineQueue;
    refineTier = s.refineTier;
    currentEvaluatedChoice = s.current;
    searchLo = s.lo; searchHi = s.hi; numberBattles = s.battles;
    if (phase === 'result') {
        hide(resultSection);
        show(choiceSection);
    }
    phase = s.phase;
    renderCurrent();
    renderChoice();
}

function updateProgress() {
    const bucketing = phase === 'bucketing';
    const placed = bucketing
        ? startingNumberToSort - startingArray.length - 1
        : destinationArray.length + skippedItems.length;
    const remaining = bucketing ? startingArray.length + 1 : estimateRemainingInteractions();
    const secs = remaining * (bucketing ? SECONDS_PER_BUCKET_CLICK : SECONDS_PER_CLICK);
    const pct = Math.min(100, Math.floor(placed / startingNumberToSort * 100));
    $('totalItems').textContent = startingNumberToSort;
    $('placedCount').textContent = placed;
    $('numberBattleDisplay').textContent = numberBattles;
    $('numberBattleMaxDisplay').textContent = remaining;
    $('remainingTime').textContent = formatDuration(secs);
    $('completionPercentage').textContent = pct;
    $('progressBar').style.width = pct + '%';
    $('undoButton').disabled = history.length === 0;
}

function quitToStart() {
    saveSession();
    hide(choiceSection);
    show(startSection);
    phase = 'input';
    checkResume();
}

// --- Results ---
function defaultTierEnds(n) {
    let cumulative = 0;
    return TIERS.map((t, i) => {
        if (i === TIERS.length - 1) return n;
        cumulative += t.share;
        return Math.round(n * cumulative);
    });
}

function tierOf(rank) {
    for (let i = 0; i < tierEnds.length; i++) if (rank < tierEnds[i]) return i;
    return TIERS.length - 1;
}

// Put the item at `rank` into tier T while keeping the ranking order intact:
// every item between its current tier and T follows it.
function assignTier(rank, T) {
    const t = tierOf(rank);
    if (T === t) return;
    if (mode === 'tiers') {
        // Quick mode: move exactly this item (next to the boundary it crosses).
        const [item] = resultItems.splice(rank, 1);
        for (let i = t; i < tierEnds.length; i++) tierEnds[i]--;
        const pos = T > t ? (T === 0 ? 0 : tierEnds[T - 1]) : tierEnds[T];
        resultItems.splice(pos, 0, item);
        for (let i = T; i < tierEnds.length; i++) tierEnds[i]++;
    } else if (T > t) {
        for (let i = t; i < T; i++) tierEnds[i] = Math.min(tierEnds[i], rank);
    } else {
        for (let i = T; i < t; i++) tierEnds[i] = Math.max(tierEnds[i], rank + 1);
    }
    renderTierList();
    renderRankingList();
    renderRefineBanner();
    saveSession();
}

// Called when the current run (full sort, bucketing or one tier refinement) is over.
function finishRun() {
    if (phase === 'bucketing') {
        resultItems = buckets.flat();
        let acc = 0;
        tierEnds = buckets.map(b => (acc += b.length));
    } else if (refineTier !== null) {
        const start = refineTier === 0 ? 0 : tierEnds[refineTier - 1];
        resultItems.splice(start, tierEnds[refineTier] - start, ...destinationArray);
        tierSorted[refineTier] = true;
        refineTier = null;
        if (refineQueue.length) { nextRefine(); return; }
    } else {
        resultItems = destinationArray.slice();
        tierEnds = defaultTierEnds(resultItems.length);
        tierSorted = TIERS.map(() => true);
    }
    showResult();
}

function showResult() {
    phase = 'result';
    hide(choiceSection);
    show(resultSection);
    if (!tierEnds || tierEnds.length !== TIERS.length) tierEnds = defaultTierEnds(resultItems.length);
    const n = resultItems.length;
    $('resultSummary').textContent =
        `${n} élément${n > 1 ? 's' : ''} placé${n > 1 ? 's' : ''} en ${numberBattles} clic${numberBattles > 1 ? 's' : ''}.`;
    $('resultUndoButton').disabled = history.length === 0;
    renderTierList();
    renderRankingList();
    renderSkipped();
    renderRefineBanner();
    saveSession();
}

function tierSize(i) { return tierEnds[i] - (i === 0 ? 0 : tierEnds[i - 1]); }

function unsortedTiers() {
    return TIERS.map((_, i) => i).filter(i => !tierSorted[i] && tierSize(i) >= 2);
}

function renderRefineBanner() {
    const todo = unsortedTiers();
    const banner = $('refineBanner');
    if (todo.length === 0) { hide(banner); return; }
    const clicks = todo.reduce((a, i) => a + estimateTotalInteractions(tierSize(i), 7), 0);
    $('refineInfo').textContent =
        `L'ordre à l'intérieur de ${todo.length} tier${todo.length > 1 ? 's' : ''} n'est pas trié (~${clicks} clics, ~${formatDuration(clicks * SECONDS_PER_CLICK)} pour tout trier).`;
    show(banner);
}

function startRefine(queue) {
    if (queue.length === 0) return;
    refineQueue = queue.slice();
    history = [];
    skippedItems = [];
    nextRefine();
}

function nextRefine() {
    refineTier = refineQueue.shift();
    const start = refineTier === 0 ? 0 : tierEnds[refineTier - 1];
    const items = resultItems.slice(start, tierEnds[refineTier]);
    startingArray = items.slice().reverse();
    startingNumberToSort = items.length;
    destinationArray = [startingArray.pop()];
    hide(resultSection);
    phase = 'sorting';
    show(choiceSection);
    nextItem();
}

function makeChip(slot, rank, showRank) {
    const imgUrl = slotImage(slot);
    const name = itemDisplay(slot);
    const chip = el('button', 'tier-chip ' + (imgUrl ? 'has-img' : 'text-only'));
    chip.type = 'button';
    chip.title = (showRank ? `#${rank + 1} · ` : '') + name;
    chip.dataset.rank = rank;

    const toTextChip = () => {
        chip.className = 'tier-chip text-only';
        chip.replaceChildren(...(showRank ? [el('span', 'chip-rank', '#' + (rank + 1))] : []), document.createTextNode(name));
    };
    if (imgUrl) {
        const img = el('img');
        img.alt = '';
        img.loading = 'lazy';
        img.onerror = toTextChip;
        img.src = imgUrl;
        chip.appendChild(img);
        chip.appendChild(el('span', 'chip-name', name));
        if (showRank) chip.appendChild(el('span', 'chip-rank', '#' + (rank + 1)));
    } else {
        if (showRank) chip.appendChild(el('span', 'chip-rank', '#' + (rank + 1)));
        chip.appendChild(document.createTextNode(name));
    }
    chip.addEventListener('click', e => { e.stopPropagation(); openTierMenu(chip, rank); });
    return chip;
}

function renderTierList() {
    const list = $('tierList');
    const frag = document.createDocumentFragment();
    TIERS.forEach((tier, i) => {
        const start = i === 0 ? 0 : tierEnds[i - 1];
        const end = tierEnds[i];
        const row = el('div', 'tier-row');
        const label = el('div', 'tier-label', tier.label);
        label.style.background = tier.color;
        label.appendChild(el('small', '', String(end - start)));
        if (!tierSorted[i] && end - start >= 2) {
            const sortBtn = el('button', 'tier-sort-btn', 'trier');
            sortBtn.type = 'button';
            sortBtn.title = `Classer les éléments du tier ${tier.label} du meilleur au moins bon`;
            sortBtn.addEventListener('click', () => startRefine([i]));
            label.appendChild(sortBtn);
        }
        const body = el('div', 'tier-body');
        for (let r = start; r < end; r++) body.appendChild(makeChip(resultItems[r], r, tierSorted[i]));
        if (end === start) body.appendChild(el('span', 'tier-empty', 'Vide'));
        row.append(label, body);
        frag.appendChild(row);
    });
    list.replaceChildren(frag);
}

function renderRankingList() {
    const frag = document.createDocumentFragment();
    resultItems.forEach((slot, i) => {
        const li = el('li', 'ranking-item' + (tierSorted[tierOf(i)] && i === 0 ? ' top1' : tierSorted[tierOf(i)] && i < 3 ? ' top3' : ''));
        li.appendChild(el('span', 'r-num', tierSorted[tierOf(i)] ? String(i + 1) : TIERS[tierOf(i)].label));
        const imgUrl = slotImage(slot);
        if (imgUrl) {
            const img = el('img');
            img.alt = '';
            img.loading = 'lazy';
            img.onerror = () => img.remove();
            img.src = imgUrl;
            li.appendChild(img);
        }
        li.appendChild(el('span', 'r-name', itemDisplay(slot)));
        frag.appendChild(li);
    });
    $('rankingView').replaceChildren(frag);
}

function renderSkipped() {
    const block = $('skippedBlock');
    if (skippedItems.length === 0) { hide(block); return; }
    $('skippedCount').textContent = skippedItems.length;
    $('skippedList').textContent = skippedItems.map(itemDisplay).join(' · ');
    show(block);
}

function rankSkipped() {
    if (skippedItems.length === 0) return;
    startingArray = skippedItems.slice().reverse();
    skippedItems = [];
    history = [];
    hide(resultSection);
    show(choiceSection);
    if (mode === 'tiers') {
        initializeBucketing(true);
    } else {
        destinationArray = resultItems.slice();
        startingNumberToSort = destinationArray.length + startingArray.length;
        tierEnds = null;
        phase = 'sorting';
        nextItem();
    }
}

function newSort() {
    if (!confirm('Abandonner ce classement et recommencer un nouveau tri ?')) return;
    clearSession();
    destinationArray = []; startingArray = []; skippedItems = []; history = []; tierEnds = null;
    resultItems = []; buckets = []; tierSorted = TIERS_FALSE(); refineQueue = []; refineTier = null;
    hide(resultSection);
    show(startSection);
    phase = 'input';
    checkResume();
}

// --- Tier popover ---
const tierMenu = $('tierMenu');

function openTierMenu(chip, rank) {
    const current = tierOf(rank);
    tierMenu.replaceChildren(...TIERS.map((tier, i) => {
        const b = el('button', i === current ? 'is-current' : '', tier.label);
        b.type = 'button';
        b.style.background = tier.color;
        b.title = `Placer dans le tier ${tier.label}`;
        b.addEventListener('click', e => { e.stopPropagation(); closeTierMenu(); assignTier(rank, i); });
        return b;
    }));
    show(tierMenu);
    const r = chip.getBoundingClientRect();
    const mw = tierMenu.offsetWidth, mh = tierMenu.offsetHeight;
    let left = Math.min(Math.max(8, r.left + r.width / 2 - mw / 2), window.innerWidth - mw - 8);
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    tierMenu.style.left = left + 'px';
    tierMenu.style.top = top + 'px';
}

function closeTierMenu() { hide(tierMenu); }

document.addEventListener('click', e => { if (!tierMenu.contains(e.target)) closeTierMenu(); });
window.addEventListener('scroll', closeTierMenu, { passive: true });

// --- Exports ---
function flatSlot(slot) { return slot.length === 1 ? slot[0] : slot; }

function copyJson() {
    writeToClipboard(JSON.stringify(resultItems.map(flatSlot)));
    flashButton($('resultDisplayCopy'), 'Copié !');
}

function tierText() {
    const lines = TIERS.map((tier, i) => {
        const start = i === 0 ? 0 : tierEnds[i - 1];
        const names = resultItems.slice(start, tierEnds[i]).map(itemDisplay);
        return `${tier.label} : ${names.join(', ') || '—'}`;
    });
    if (skippedItems.length) lines.push(`Non classés : ${skippedItems.map(itemDisplay).join(', ')}`);
    return lines.join('\n');
}

function copyText() {
    writeToClipboard(tierText());
    flashButton($('copyTextButton'), 'Copié !');
}

function loadImage(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const timer = setTimeout(() => resolve(null), 8000);
        img.onload = () => { clearTimeout(timer); resolve(img); };
        img.onerror = () => { clearTimeout(timer); resolve(null); };
        img.src = url;
    });
}

function wrapText(ctx, text, maxWidth, maxLines) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
        const test = line ? line + ' ' + w : w;
        if (ctx.measureText(test).width > maxWidth && line) {
            lines.push(line);
            line = w;
        } else {
            line = test;
        }
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
        lines.length = maxLines;
        lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '…');
    }
    return lines;
}

async function exportPng() {
    const btn = $('exportPngButton');
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Génération…';
    try {
        const W = 1280, labelW = 110, tile = 96, gap = 4, pad = 4;
        const cols = Math.floor((W - labelW - pad) / (tile + gap));
        const images = await Promise.all(resultItems.map(slot => {
            const u = slotImage(slot);
            return u ? loadImage(u) : Promise.resolve(null);
        }));

        const rowsPerTier = TIERS.map((_, i) => {
            const n = tierEnds[i] - (i === 0 ? 0 : tierEnds[i - 1]);
            return Math.max(1, Math.ceil(n / cols));
        });
        const rowHeights = rowsPerTier.map(r => r * (tile + gap) + pad);
        const H = rowHeights.reduce((a, b) => a + b, 0) + TIERS.length * 2;

        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#171717';
        ctx.fillRect(0, 0, W, H);

        let y = 0;
        TIERS.forEach((tier, i) => {
            const start = i === 0 ? 0 : tierEnds[i - 1];
            const end = tierEnds[i];
            const h = rowHeights[i];
            ctx.fillStyle = '#262626';
            ctx.fillRect(labelW, y, W - labelW, h);
            ctx.fillStyle = tier.color;
            ctx.fillRect(0, y, labelW, h);
            ctx.fillStyle = '#171717';
            ctx.font = '800 44px system-ui, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(tier.label, labelW / 2, y + h / 2);

            for (let r = start; r < end; r++) {
                const idx = r - start;
                const x = labelW + pad + (idx % cols) * (tile + gap);
                const ty = y + pad + Math.floor(idx / cols) * (tile + gap);
                const img = images[r];
                const name = itemDisplay(resultItems[r]);
                if (img) {
                    // cover-fit
                    const s = Math.max(tile / img.width, tile / img.height);
                    const sw = tile / s, sh = tile / s;
                    ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, ty, tile, tile);
                    const grad = ctx.createLinearGradient(0, ty + tile - 30, 0, ty + tile);
                    grad.addColorStop(0, 'rgba(0,0,0,0)');
                    grad.addColorStop(1, 'rgba(0,0,0,0.85)');
                    ctx.fillStyle = grad;
                    ctx.fillRect(x, ty + tile - 30, tile, 30);
                    ctx.fillStyle = '#fff';
                    ctx.font = '700 11px system-ui, sans-serif';
                    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
                    const lines = wrapText(ctx, name, tile - 6, 2);
                    lines.forEach((ln, li) => ctx.fillText(ln, x + tile / 2, ty + tile - 4 - (lines.length - 1 - li) * 12));
                } else {
                    ctx.fillStyle = '#404040';
                    ctx.fillRect(x, ty, tile, tile);
                    ctx.fillStyle = '#fff';
                    ctx.font = '700 13px system-ui, sans-serif';
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    const lines = wrapText(ctx, name, tile - 10, 5);
                    lines.forEach((ln, li) => ctx.fillText(ln, x + tile / 2, ty + tile / 2 + (li - (lines.length - 1) / 2) * 16));
                }
            }
            y += h + 2;
        });

        const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
        if (!blob) throw new Error('toBlob failed');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'tier-list.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        btn.textContent = 'Image téléchargée !';
    } catch (err) {
        console.error(err);
        btn.textContent = 'Échec de l\'export';
    }
    setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1800);
}

// --- Keyboard shortcuts ---
document.addEventListener('keydown', e => {
    if ($('assistedTab').classList.contains('hidden')) return;
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (e.key === 'Escape') { closeTierMenu(); return; }

    const isUndo = (e.key === 'Backspace') || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z');
    if (isUndo && (phase === 'sorting' || phase === 'result') && history.length) {
        e.preventDefault();
        undo();
        return;
    }
    if ((phase !== 'sorting' && phase !== 'bucketing') || e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key.toLowerCase() === 'p') { if (refineTier === null) skipCurrent(); return; }
    if (phase === 'bucketing') {
        let ti = TIER_KEYS.indexOf(e.key.toLowerCase());
        if (ti < 0 && /^[1-6]$/.test(e.key)) ti = parseInt(e.key) - 1;
        if (ti >= 0) bucketClick(ti);
        return;
    }
    if (/^[0-9]$/.test(e.key)) {
        const idx = e.key === '0' ? 9 : parseInt(e.key) - 1;
        const btn = anchorContainer.querySelector(`.gap-bar[data-gap="${idx}"]`);
        if (btn) btn.click();
    }
});

// --- File import ---
$('fileInput').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { inputEl.value = String(reader.result); updateInputInfo(); };
    reader.readAsText(file);
    e.target.value = '';
});

// --- Result view toggle ---
document.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('is-active', b === btn));
        const tiers = btn.dataset.view === 'tiers';
        $('tierView').classList.toggle('hidden', !tiers);
        $('rankingView').classList.toggle('hidden', tiers);
    });
});

// --- Assisted-tab event listeners ---
$("startButton").addEventListener("click", start);
inputEl.addEventListener("input", updateInputInfo);
$("configKInput").addEventListener("input", updateConfigEstimate);
$("configValidateButton").addEventListener("click", validateConfig);
$("configBackButton").addEventListener("click", backToInput);
$("undoButton").addEventListener("click", undo);
$("skipButton").addEventListener("click", skipCurrent);
$("saveQuitButton").addEventListener("click", quitToStart);
$("resumeButton").addEventListener("click", resumeSession);
$("resumeDiscardButton").addEventListener("click", () => { clearSession(); checkResume(); });
$("tierResetButton").addEventListener("click", () => { tierEnds = defaultTierEnds(resultItems.length); renderTierList(); renderRankingList(); renderRefineBanner(); saveSession(); });
$("rankSkippedButton").addEventListener("click", rankSkipped);
$("exportPngButton").addEventListener("click", exportPng);
$("copyTextButton").addEventListener("click", copyText);
$("resultDisplayCopy").addEventListener("click", copyJson);
$("resultUndoButton").addEventListener("click", undo);
$("newSortButton").addEventListener("click", newSort);
$("refineButton").addEventListener("click", () => startRefine(unsortedTiers()));
document.querySelectorAll('input[name="sortMode"]').forEach(r => r.addEventListener('change', updateConfigEstimate));

updateInputInfo();
checkResume();

// --- Tab switching ---
document.querySelectorAll('.tab-button').forEach(btn => {
    btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        document.querySelectorAll('.tab-button').forEach(b => {
            b.classList.toggle('is-active', b.dataset.tab === target);
        });
        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.toggle('hidden', panel.id !== target + 'Tab');
        });
    });
});

// --- Manual sort tab ---
const manualStartSection = document.getElementById('manualStartSection');
const manualSortSection = document.getElementById('manualSortSection');
const manualBubbleList = document.getElementById('manualBubbleList');
const manualEmptyState = document.getElementById('manualEmptyState');
const manualAddInput = document.getElementById('manualAddInput');
const manualCopyButton = document.getElementById('manualCopyButton');

let manualList = [];
let manualColors = [];
let manualDraggedIndex = -1;
let manualDraggedBubble = null;
let manualPlaceholderEl = null;
let manualCurrentGap = null;

// Hand-picked palette (Tailwind 700) ordered so consecutive indices are
// far apart on the color wheel. All shades are dark enough for white text.
const BUBBLE_COLORS = [
    '#b91c1c', // red
    '#15803d', // green
    '#0369a1', // sky
    '#7e22ce', // purple
    '#c2410c', // orange
    '#047857', // emerald
    '#1d4ed8', // blue
    '#a21caf', // fuchsia
    '#b45309', // amber
    '#0f766e', // teal
    '#4338ca', // indigo
    '#be123c', // rose
    '#4d7c0f', // lime
    '#0e7490', // cyan
    '#6d28d9', // violet
];

// Pick the least-used palette color (ties broken by palette order) so new
// items maximize contrast against what's already in the list.
function nextBubbleColor() {
    let bestIdx = 0;
    let bestCount = Infinity;
    for (let i = 0; i < BUBBLE_COLORS.length; i++) {
        const count = manualColors.reduce((n, c) => n + (c === BUBBLE_COLORS[i] ? 1 : 0), 0);
        if (count < bestCount) {
            bestCount = count;
            bestIdx = i;
            if (count === 0) break;
        }
    }
    return BUBBLE_COLORS[bestIdx];
}

function manualLoad() {
    const raw = document.getElementById('manualInput').value;
    manualList = parseInputList(raw);
    manualColors = manualList.map((_, i) => BUBBLE_COLORS[i % BUBBLE_COLORS.length]);
    hide(manualStartSection);
    show(manualSortSection);
    renderManualList();
}

function manualStartEmpty() {
    manualList = [];
    manualColors = [];
    hide(manualStartSection);
    show(manualSortSection);
    renderManualList();
    manualAddInput.focus();
}

function manualReset() {
    manualList = [];
    manualColors = [];
    document.getElementById('manualInput').value = '';
    manualAddInput.value = '';
    hide(manualSortSection);
    show(manualStartSection);
}

function manualAdd() {
    const raw = manualAddInput.value.trim();
    if (raw === '') return;
    manualList.push(raw);
    manualColors.push(nextBubbleColor());
    manualAddInput.value = '';
    renderManualList();
    requestAnimationFrame(() => {
        const last = manualBubbleList.lastElementChild;
        if (last) last.scrollIntoView({ block: 'nearest' });
    });
}

function manualRemove(index) {
    manualList.splice(index, 1);
    manualColors.splice(index, 1);
    renderManualList();
}

function manualMove(from, to) {
    if (from === to) return;
    if (from < 0 || from >= manualList.length) return;
    if (to < 0 || to >= manualList.length) return;
    const [item] = manualList.splice(from, 1);
    manualList.splice(to, 0, item);
    const [color] = manualColors.splice(from, 1);
    manualColors.splice(to, 0, color);
    renderManualList();
}

function ensurePlaceholder() {
    if (!manualPlaceholderEl) {
        manualPlaceholderEl = document.createElement('li');
        manualPlaceholderEl.className = 'manual-bubble-placeholder';
        manualPlaceholderEl.setAttribute('aria-hidden', 'true');
    }
    return manualPlaceholderEl;
}

function clearManualDrop() {
    if (manualPlaceholderEl && manualPlaceholderEl.parentNode) {
        manualPlaceholderEl.parentNode.removeChild(manualPlaceholderEl);
    }
    manualCurrentGap = null;
}

function getRealBubbles() {
    return Array.from(manualBubbleList.querySelectorAll('.manual-bubble'))
        .filter(el => el !== manualDraggedBubble);
}

// Returns gap index in [0..realBubbles.length] corresponding to where the
// cursor would insert the dragged bubble. Weighs Y heavily when the cursor
// isn't on a bubble's row so we don't pick across rows.
function findDropGap(clientX, clientY) {
    const bubbles = getRealBubbles();
    if (bubbles.length === 0) return 0;
    let bestIdx = -1;
    let bestDist = Infinity;
    let bestRect = null;
    for (let i = 0; i < bubbles.length; i++) {
        const rect = bubbles[i].getBoundingClientRect();
        if (rect.width === 0) continue;
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        let dist;
        if (clientY >= rect.top && clientY <= rect.bottom) {
            dist = Math.abs(clientX - cx);
        } else {
            dist = Math.abs(clientY - cy) * 5 + Math.abs(clientX - cx) * 0.2;
        }
        if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
            bestRect = rect;
        }
    }
    if (bestIdx < 0) return 0;
    const isAfter = clientX > bestRect.left + bestRect.width / 2;
    return bestIdx + (isAfter ? 1 : 0);
}

// FLIP: snapshot positions, apply DOM mutation, invert + play so siblings
// glide to their new spots instead of snapping.
function withFlipAnimation(callback) {
    const firsts = new Map();
    for (const el of manualBubbleList.children) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0) firsts.set(el, rect);
    }
    callback();
    const toAnimate = [];
    for (const el of manualBubbleList.children) {
        if (!firsts.has(el)) continue;
        const first = firsts.get(el);
        const last = el.getBoundingClientRect();
        if (last.width === 0) continue;
        const dx = first.left - last.left;
        const dy = first.top - last.top;
        if (dx === 0 && dy === 0) continue;
        toAnimate.push({ el, dx, dy });
    }
    if (toAnimate.length === 0) return;
    for (const { el, dx, dy } of toAnimate) {
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    void manualBubbleList.offsetHeight;
    for (const { el } of toAnimate) {
        el.style.transition = '';
        el.style.transform = '';
    }
}

function setManualDropGap(gap) {
    if (gap === manualCurrentGap) return;
    manualCurrentGap = gap;
    const placeholder = ensurePlaceholder();
    withFlipAnimation(() => {
        const bubbles = getRealBubbles();
        if (gap >= bubbles.length) {
            if (placeholder !== manualBubbleList.lastElementChild) {
                manualBubbleList.appendChild(placeholder);
            }
        } else {
            const target = bubbles[gap];
            if (placeholder.nextElementSibling !== target) {
                manualBubbleList.insertBefore(placeholder, target);
            }
        }
    });
}

function renderManualList() {
    document.getElementById('manualItemCount').textContent = manualList.length;
    manualEmptyState.classList.toggle('hidden', manualList.length > 0);

    const parts = manualList.map((item, i) => {
        const rawText = itemDisplay(item);
        const text = escapeHtml(rawText);
        const color = manualColors[i];
        const upDisabled = i === 0 ? 'disabled' : '';
        const downDisabled = i === manualList.length - 1 ? 'disabled' : '';
        const bubbleImgUrl = slotImage(item);
        const bubbleImgHtml = bubbleImgUrl
            ? `<img class="bubble-img" src="${escapeAttr(bubbleImgUrl)}" alt="${escapeAttr(rawText)}" loading="lazy">`
            : '';
        return `<li class="manual-bubble${bubbleImgUrl ? ' has-image' : ''}" draggable="true" data-index="${i}" title="${text}">` +
            `${bubbleImgHtml}` +
            `<span class="bubble-rank">${i + 1}</span>` +
            `<span class="bubble-text">${text}</span>` +
            `<span class="bubble-actions">` +
            `<button type="button" class="icon-btn up" title="Monter" aria-label="Monter" ${upDisabled}>▲</button>` +
            `<button type="button" class="icon-btn down" title="Descendre" aria-label="Descendre" ${downDisabled}>▼</button>` +
            `<button type="button" class="icon-btn delete" title="Supprimer" aria-label="Supprimer">×</button>` +
            `</span>` +
            `</li>`;
    });
    manualBubbleList.innerHTML = parts.join('');

    manualBubbleList.querySelectorAll('.manual-bubble').forEach(bubble => {
        const idx = parseInt(bubble.dataset.index);
        bubble.style.background = manualColors[idx];

        bubble.querySelector('.up').addEventListener('click', () => manualMove(idx, idx - 1));
        bubble.querySelector('.down').addEventListener('click', () => manualMove(idx, idx + 1));
        bubble.querySelector('.delete').addEventListener('click', () => manualRemove(idx));

        // Disable native drag when interaction starts on an action button so
        // clicks fire normally instead of starting a drag.
        bubble.addEventListener('mousedown', e => {
            bubble.setAttribute('draggable', e.target.closest('.icon-btn') ? 'false' : 'true');
        });

        bubble.addEventListener('dragstart', e => {
            manualDraggedIndex = idx;
            manualDraggedBubble = bubble;
            bubble.classList.add('is-dragging');
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                // Firefox needs data set to actually start the drag
                e.dataTransfer.setData('text/plain', String(idx));
            }
            // Size the placeholder to match the dragged bubble, then defer
            // hiding so the browser captures the drag image first.
            const rect = bubble.getBoundingClientRect();
            const placeholder = ensurePlaceholder();
            placeholder.style.width = `${rect.width}px`;
            placeholder.style.height = `${rect.height}px`;
            setTimeout(() => {
                if (manualDraggedBubble !== bubble) return;
                bubble.classList.add('is-dragging-hidden');
                manualBubbleList.insertBefore(placeholder, bubble);
                manualCurrentGap = idx;
            }, 0);
        });

        bubble.addEventListener('dragend', () => {
            bubble.classList.remove('is-dragging', 'is-dragging-hidden');
            clearManualDrop();
            manualDraggedIndex = -1;
            manualDraggedBubble = null;
        });
    });
}

// Drop targeting is computed at the list level so gaps between bubbles are
// detected correctly (per-bubble dragover would miss the 0.5rem gaps).
manualBubbleList.addEventListener('dragover', e => {
    if (manualDraggedIndex === -1) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    setManualDropGap(findDropGap(e.clientX, e.clientY));
});

manualBubbleList.addEventListener('drop', e => {
    if (manualDraggedIndex === -1) return;
    e.preventDefault();
    const gap = manualCurrentGap !== null ? manualCurrentGap : findDropGap(e.clientX, e.clientY);
    const from = manualDraggedIndex;
    const to = Math.max(0, Math.min(manualList.length - 1, gap));
    if (from !== to) manualMove(from, to);
});

async function manualCopy() {
    await writeToClipboard(JSON.stringify(manualList));
    const original = manualCopyButton.textContent;
    manualCopyButton.textContent = 'Copié !';
    setTimeout(() => { manualCopyButton.textContent = original; }, 1500);
}

// --- Event listeners ---

document.getElementById('manualLoadButton').addEventListener('click', manualLoad);
document.getElementById('manualStartEmptyButton').addEventListener('click', manualStartEmpty);
document.getElementById('manualAddButton').addEventListener('click', manualAdd);
manualAddInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        e.preventDefault();
        manualAdd();
    }
});
manualCopyButton.addEventListener('click', manualCopy);
document.getElementById('manualResetButton').addEventListener('click', manualReset);
