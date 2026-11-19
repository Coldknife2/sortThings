// =====================================================================
// sortThings – tri assisté par insertion multi-jalons
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
let phase = 'input';          // input | config | sorting | result
let resultItems = [];         // final ranked list of slots

const SECONDS_PER_CLICK = 4;
const STORAGE_KEY = 'sortThings.session.v1';
const MANUAL_STORAGE_KEY = 'sortThings.manual.v1';

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
    const base = k + 1;
    let remaining = 0;
    for (let i = 0; i <= startingArray.length; i++) {
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
            v: 3, phase, k, numberBattles, startingNumberToSort, startingArray, destinationArray,
            skippedItems, current: currentEvaluatedChoice ?? null, lo: searchLo, hi: searchHi,
            resultItems, savedAt: Date.now(),
        }));
    } catch (_) { /* storage unavailable or full */ }
}

function clearSession() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) { }
}

function saveManualSession() {
    try {
        localStorage.setItem(MANUAL_STORAGE_KEY, JSON.stringify({
            v: 1,
            list: manualList,
            colors: manualColors,
            savedAt: Date.now(),
        }));
    } catch (_) { /* storage unavailable or full */ }
}

function clearManualSession() {
    try { localStorage.removeItem(MANUAL_STORAGE_KEY); } catch (_) { }
}

function readManualSession() {
    try {
        const raw = localStorage.getItem(MANUAL_STORAGE_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (!s || s.v !== 1 || !Array.isArray(s.list)) return null;
        return s;
    } catch (_) { return null; }
}

function readSession() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (!s || !Array.isArray(s.destinationArray) || !Array.isArray(s.startingArray)) return null;
        if (s.v === 3 && ['sorting', 'result'].includes(s.phase)) return s;
        if (s.v === 2 && s.mode === 'full' && s.refineTier == null &&
            ['sorting', 'result'].includes(s.phase)) {
            return { ...s, v: 3, resultItems: Array.isArray(s.resultItems) ? s.resultItems : s.destinationArray };
        }
        return null;
    } catch (_) { return null; }
}

function checkResume() {
    const s = readSession();
    if (!s) { hide($("resumeBanner")); return; }
    $("resumeInfo").textContent = s.phase === 'result'
        ? `Classement terminé : ${s.resultItems.length} éléments.`
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
    k = s.k; numberBattles = s.numberBattles; startingNumberToSort = s.startingNumberToSort;
    resultItems = Array.isArray(s.resultItems) ? s.resultItems : [];
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
    updateConfigEstimate();
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
}

function backToInput() {
    hide(configSection);
    show(startSection);
    phase = 'input';
    checkResume();
}

function validateConfig() {
    k = readConfigK();
    hide(configSection);
    initializeSorting();
}

function toSlot(item) {
    return Array.isArray(item) ? item : [item];
}

// --- Sorting ---
function resetRunState() {
    numberBattles = 0;
    history = [];
    skippedItems = [];
    resultItems = [];
}

// Insert each item at its position relative to the already-ranked items.
function initializeSorting() {
    resetRunState();
    destinationArray = [toSlot(startingArray.pop())];
    phase = 'sorting';
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
    renderAnchors();
}

function updateChoiceChrome() {
    $('ladderHint').innerHTML = 'Clique sur l\'emplacement où cet élément se range. Raccourcis : touches <kbd>1</kbd>–<kbd>9</kbd>.';
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

function pushSnapshot() {
    history.push({
        phase,
        starting: startingArray.slice(),
        dest: destinationArray.slice(),
        skipped: skippedItems.slice(),
        resultItems: resultItems.slice(),
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
    if (phase !== 'sorting') return;
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
    resultItems = s.resultItems;
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
    const placed = destinationArray.length + skippedItems.length;
    const remaining = estimateRemainingInteractions();
    const secs = remaining * SECONDS_PER_CLICK;
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
function finishRun() {
    resultItems = destinationArray.slice();
    showResult();
}

function showResult() {
    phase = 'result';
    hide(choiceSection);
    show(resultSection);
    const n = resultItems.length;
    $('resultSummary').textContent =
        `${n} élément${n > 1 ? 's' : ''} placé${n > 1 ? 's' : ''} en ${numberBattles} clic${numberBattles > 1 ? 's' : ''}.`;
    $('resultUndoButton').disabled = history.length === 0;
    renderRankingList();
    renderSkipped();
    saveSession();
}

function renderRankingList() {
    const frag = document.createDocumentFragment();
    resultItems.forEach((slot, i) => {
        const li = el('li', 'ranking-item' + (i === 0 ? ' top1' : i < 3 ? ' top3' : ''));
        li.appendChild(el('span', 'r-num', String(i + 1)));
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
    destinationArray = resultItems.slice();
    startingNumberToSort = destinationArray.length + startingArray.length;
    phase = 'sorting';
    nextItem();
}

function newSort() {
    if (!confirm('Abandonner ce classement et recommencer un nouveau tri ?')) return;
    clearSession();
    destinationArray = []; startingArray = []; skippedItems = []; history = [];
    resultItems = [];
    hide(resultSection);
    show(startSection);
    phase = 'input';
    checkResume();
}

// --- Exports ---
function flatSlot(slot) { return Array.isArray(slot) && slot.length === 1 ? slot[0] : slot; }

function copyJson() {
    writeToClipboard(JSON.stringify(resultItems.map(flatSlot), null, 2));
    flashButton($('resultDisplayCopy'), 'Copié !');
}

function downloadJson() {
    const json = JSON.stringify(resultItems.map(flatSlot), null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sortthings-classement.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function rankedText() {
    const lines = resultItems.map((slot, i) => `${i + 1}. ${itemDisplay(slot)}`);
    if (skippedItems.length) lines.push('', `Non classés : ${skippedItems.map(itemDisplay).join(', ')}`);
    return lines.join('\n');
}

function copyText() {
    writeToClipboard(rankedText());
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
        const W = 1280, tile = 96, gap = 8, pad = 8;
        const cols = Math.max(1, Math.floor((W - pad * 2) / (tile + gap)));
        const images = await Promise.all(resultItems.map(slot => {
            const u = slotImage(slot);
            return u ? loadImage(u) : Promise.resolve(null);
        }));

        const rows = Math.max(1, Math.ceil(resultItems.length / cols));
        const H = pad * 2 + rows * (tile + gap);

        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#171717';
        ctx.fillRect(0, 0, W, H);

        resultItems.forEach((slot, i) => {
            const x = pad + (i % cols) * (tile + gap);
            const y = pad + Math.floor(i / cols) * (tile + gap);
            const img = images[i];
            const name = itemDisplay(slot);
            if (img) {
                const s = Math.max(tile / img.width, tile / img.height);
                const sw = tile / s, sh = tile / s;
                ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, tile, tile);
                const grad = ctx.createLinearGradient(0, y + tile - 30, 0, y + tile);
                grad.addColorStop(0, 'rgba(0,0,0,0)');
                grad.addColorStop(1, 'rgba(0,0,0,0.85)');
                ctx.fillStyle = grad;
                ctx.fillRect(x, y + tile - 30, tile, 30);
                ctx.fillStyle = '#fff';
                ctx.font = '700 11px system-ui, sans-serif';
                ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
                const lines = wrapText(ctx, name, tile - 6, 2);
                lines.forEach((ln, li) => ctx.fillText(ln, x + tile / 2, y + tile - 4 - (lines.length - 1 - li) * 12));
            } else {
                ctx.fillStyle = '#404040';
                ctx.fillRect(x, y, tile, tile);
                ctx.fillStyle = '#fff';
                ctx.font = '700 13px system-ui, sans-serif';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                const lines = wrapText(ctx, name, tile - 10, 5);
                lines.forEach((ln, li) => ctx.fillText(ln, x + tile / 2, y + tile / 2 + (li - (lines.length - 1) / 2) * 16));
            }
            ctx.fillStyle = '#2563eb';
            ctx.fillRect(x, y, 24, 20);
            ctx.fillStyle = '#fff';
            ctx.font = '700 11px system-ui, sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(String(i + 1), x + 12, y + 10);
        });

        const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
        if (!blob) throw new Error('toBlob failed');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'sortthings-classement.png';
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

    const isUndo = (e.key === 'Backspace') || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z');
    if (isUndo && (phase === 'sorting' || phase === 'result') && history.length) {
        e.preventDefault();
        undo();
        return;
    }
    if (phase !== 'sorting' || e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key.toLowerCase() === 'p') { skipCurrent(); return; }
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
$("rankSkippedButton").addEventListener("click", rankSkipped);
$("exportPngButton").addEventListener("click", exportPng);
$("copyTextButton").addEventListener("click", copyText);
$("resultDisplayCopy").addEventListener("click", copyJson);
$("downloadJsonButton").addEventListener("click", downloadJson);
$("resultUndoButton").addEventListener("click", undo);
$("newSortButton").addEventListener("click", newSort);

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
    saveManualSession();
}

function manualStartEmpty() {
    manualList = [];
    manualColors = [];
    hide(manualStartSection);
    show(manualSortSection);
    renderManualList();
    saveManualSession();
    manualAddInput.focus();
}

function manualReset() {
    clearManualSession();
    manualList = [];
    manualColors = [];
    document.getElementById('manualInput').value = '';
    manualAddInput.value = '';
    hide(manualSortSection);
    show(manualStartSection);
    checkManualResume();
}

function manualAdd() {
    const raw = manualAddInput.value.trim();
    if (raw === '') return;
    manualList.push(raw);
    manualColors.push(nextBubbleColor());
    manualAddInput.value = '';
    renderManualList();
    saveManualSession();
    requestAnimationFrame(() => {
        const last = manualBubbleList.lastElementChild;
        if (last) last.scrollIntoView({ block: 'nearest' });
    });
}

function manualRemove(index) {
    manualList.splice(index, 1);
    manualColors.splice(index, 1);
    renderManualList();
    saveManualSession();
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
    saveManualSession();
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

function checkManualResume() {
    const s = readManualSession();
    if (!s) {
        hide(document.getElementById('manualResumeBanner'));
        return;
    }
    document.getElementById('manualResumeInfo').textContent =
        `${s.list.length} élément${s.list.length > 1 ? 's' : ''} dans le classement en cours.`;
    show(document.getElementById('manualResumeBanner'));
}

document.getElementById('manualResumeButton').addEventListener('click', () => {
    const s = readManualSession();
    if (!s) return;
    manualList = s.list;
    manualColors = Array.isArray(s.colors) ? s.colors : s.list.map((_, i) => BUBBLE_COLORS[i % BUBBLE_COLORS.length]);
    hide(manualStartSection);
    show(manualSortSection);
    renderManualList();
});

document.getElementById('manualResumeDiscardButton').addEventListener('click', () => {
    clearManualSession();
    checkManualResume();
});

window.addEventListener('pagehide', () => {
    if (phase === 'sorting' || phase === 'result') saveSession();
    if (manualSortSection && !manualSortSection.classList.contains('hidden')) saveManualSession();
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    if (phase === 'sorting' || phase === 'result') saveSession();
    if (manualSortSection && !manualSortSection.classList.contains('hidden')) saveManualSession();
});

checkManualResume();
