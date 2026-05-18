// --- DOM refs ---
const startSection = document.getElementById("startSection");
const configSection = document.getElementById("configSection");
const choiceSection = document.getElementById("choiceSection");
const resultDisplaySection = document.getElementById("resultDisplaySection");
const resultDisplayCopy = document.getElementById("resultDisplayCopy");
const anchorContainer = document.getElementById("anchorContainer");

// --- State ---
let startingArray = [];
let destinationArray = [];
let currentEvaluatedChoice;
let searchLo, searchHi; // bounds as element indices in destinationArray; -1 = before all
let k = 7; // number of anchor elements shown simultaneously
let numberBattles = 0;
let startingNumberToSort = 0;

// --- Utilities ---
function escapeHtml(text) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(String(text)));
    return div.innerHTML;
}

function itemDisplay(slot) {
    return Array.isArray(slot) ? slot.join(' / ') : String(slot);
}

function truncate(str, n) {
    return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

async function writeToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const el = document.createElement('textarea');
        el.value = text;
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
    }
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

function findRecommendedK(n) {
    for (let kk = 1; kk <= 20; kk++) {
        if (estimateTotalInteractions(n, kk) <= 100) return kk;
    }
    return 20;
}

// --- Input ---
// Accepts either a JSON array (of strings or nested arrays of strings) or a
// newline-separated list. Falls back to newline parsing if JSON parsing fails
// or the parsed value is not an array.
function parseInputList(raw) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed
                    .map(item => {
                        if (Array.isArray(item)) {
                            return item.map(s => String(s).trim()).filter(s => s !== '');
                        }
                        return String(item).trim();
                    })
                    .filter(item => Array.isArray(item) ? item.length > 0 : item !== '');
            }
        } catch (_) {
            // fall through to newline parsing
        }
    }
    return raw.split('\n').map(t => t.trim()).filter(t => t !== '');
}

function createArrayFromInput() {
    startingArray = parseInputList(document.getElementById("input").value);
}

// --- Start flow ---
function start() {
    createArrayFromInput();
    if (startingArray.length < 2) return;
    startingNumberToSort = startingArray.length;
    hide(startSection);
    showConfigScreen();
}

function showConfigScreen() {
    show(configSection);
    document.getElementById('configItemCount').textContent = startingNumberToSort;

    const baseline = estimateTotalInteractions(startingNumberToSort, 1);
    document.getElementById('configBaselineEstimate').textContent = baseline;

    const rec = findRecommendedK(startingNumberToSort);
    document.getElementById('configRecommendedK').textContent = rec;
    document.getElementById('configRecommendedEstimate').textContent =
        estimateTotalInteractions(startingNumberToSort, rec);

    document.getElementById('configKInput').value = rec;
    updateConfigEstimate();
}

function updateConfigEstimate() {
    const raw = parseInt(document.getElementById('configKInput').value);
    const kk = isNaN(raw) ? 1 : Math.max(1, Math.min(20, raw));
    document.getElementById('configCustomEstimate').textContent =
        estimateTotalInteractions(startingNumberToSort, kk);
}

function validateConfig() {
    const raw = parseInt(document.getElementById('configKInput').value);
    k = isNaN(raw) ? 7 : Math.max(1, Math.min(20, raw));
    hide(configSection);
    initializeSorting();
}

function toSlot(item) {
    return Array.isArray(item) ? item : [item];
}

// --- Sorting ---
function initializeSorting() {
    numberBattles = 0;
    destinationArray = [toSlot(startingArray.pop())];
    document.getElementById('totalItems').textContent = startingNumberToSort;
    show(choiceSection);
    nextItem();
}

function nextItem() {
    if (startingArray.length === 0) {
        hide(choiceSection);
        displayResults();
        return;
    }
    currentEvaluatedChoice = startingArray.pop();
    document.getElementById('currentItemDisplay').textContent = itemDisplay(currentEvaluatedChoice);
    document.getElementById('currentItemNumber').textContent =
        startingNumberToSort - startingArray.length;
    searchLo = -1;
    searchHi = destinationArray.length;
    renderAnchors();
}

// Returns indices in destinationArray to use as anchors for the current search window.
function getAnchorIndices() {
    const lo = searchLo + 1;
    const hi = searchHi - 1;
    const count = hi - lo + 1;

    if (count <= 0) return [];

    const numAnchors = Math.min(k, count);

    if (numAnchors === count) {
        return Array.from({ length: count }, (_, i) => lo + i);
    }

    if (numAnchors === 1) {
        return [Math.floor((lo + hi) / 2)];
    }

    return Array.from({ length: numAnchors }, (_, j) =>
        lo + Math.round(j * (count - 1) / (numAnchors - 1))
    );
}

function renderAnchors() {
    const anchorIndices = getAnchorIndices();

    if (anchorIndices.length === 0) {
        insertCurrent(searchLo + 1);
        return;
    }

    const parts = [];
    const totalGaps = anchorIndices.length + 1;

    for (let i = 0; i <= anchorIndices.length; i++) {
        let label;
        if (i === 0) label = '← Ici';
        else if (i === anchorIndices.length) label = 'Ici →';
        else label = 'Ici';

        parts.push(
            `<button class="gap-btn flex-none bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 ` +
            `text-white text-xs font-semibold py-3 px-3 rounded-lg cursor-pointer whitespace-nowrap transition-colors" ` +
            `data-gap="${i}">${escapeHtml(label)}</button>`
        );

        if (i < anchorIndices.length) {
            const idx = anchorIndices[i];
            const text = itemDisplay(destinationArray[idx]);
            const rank = idx + 1;
            const displayText = escapeHtml(text);
            const fullText = displayText;
            parts.push(
                `<div class="flex-none bg-blue-700 text-white rounded-lg text-center py-2 px-3 select-none flex flex-col justify-center" ` +
                `style="min-width:14rem;max-width:22rem;min-height:5rem;" title="${fullText}">` +
                `<div class="text-blue-300 text-xs mb-1">#${rank}</div>` +
                `<div class="text-sm leading-snug break-words whitespace-pre-wrap">${displayText}</div>` +
                `</div>`
            );
        }
    }

    anchorContainer.innerHTML = parts.join('');

    anchorContainer.querySelectorAll('.gap-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            handleGapClick(parseInt(btn.dataset.gap), anchorIndices);
        });
    });

    updateProgress();
}

function handleGapClick(gapIndex, anchorIndices) {
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
    updateProgress();
    nextItem();
}

function updateProgress() {
    document.getElementById('numberBattleDisplay').textContent = numberBattles;
    document.getElementById('numberBattleMaxDisplay').textContent = estimateRemainingInteractions();
    const pct = Math.floor(destinationArray.length / startingNumberToSort * 100);
    document.getElementById('completionPercentage').textContent = pct;
    document.getElementById('progressBar').style.width = pct + '%';
}

// --- Results ---
function displayResults() {
    show(resultDisplayCopy);
    const summary = document.getElementById('resultSummary');
    summary.textContent =
        `Tri terminé en ${numberBattles} passe${numberBattles > 1 ? 's' : ''} ` +
        `(${startingNumberToSort} élément${startingNumberToSort > 1 ? 's' : ''} triés)`;
    show(summary);
    const result = destinationArray.map((value, index) => {
        const text = escapeHtml(itemDisplay(value));
        if (index === 0) return templateResultBestCase.replace("{#Number#}", 1).replace("{#Text#}", text);
        if (index < 3) return templateResultTop3Case.replace("{#Number#}", index + 1).replace("{#Text#}", text);
        return templateResultWhiteCase.replace("{#Number#}", index + 1).replace("{#Text#}", text);
    });
    resultDisplaySection.innerHTML = result.join("");
}

const templateResultWhiteCase =
    `<div class="flex flex-auto place-items-center border-2 border-black py-2 px-4 rounded m-4 text-center">` +
    `<div class="inline-block pr-2 mr-2 border-r-2 border-black">{#Number#}</div>` +
    `<div class="inline-block whitespace-pre-wrap">{#Text#}</div></div>`;

const templateResultBestCase =
    `<div class="flex flex-auto place-items-center border-2 border-black bg-yellow-600 py-2 px-4 rounded m-4 text-white text-center">` +
    `<div class="inline-block pr-2 mr-2 border-r-2 border-black">` +
    `<svg class="w-12" x="0px" y="0px" viewBox="0 0 130 130"><g><path ` +
    `d="m 64.000012,31.484944 28.902346,36.127871 28.902242,-36.127871 -7.22553,65.030147 -101.158086,0 L 6.1954237,31.484944 35.0977,67.612815 64.000012,31.484944 z" ` +
    `fill="#ffcd00" fill-opacity="1" fill-rule="evenodd" stroke="#000000" stroke-width="4.33534527" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="4" stroke-opacity="1"/></g></svg>` +
    `</div><div class="inline-block whitespace-pre-wrap">{#Text#}</div></div>`;

const templateResultTop3Case =
    `<div class="flex flex-auto place-items-center border-2 border-black bg-green-700 py-2 px-4 rounded m-4 text-white text-center">` +
    `<div class="inline-block pr-2 mr-2 border-r-2 border-black">{#Number#}</div>` +
    `<div class="inline-block whitespace-pre-wrap">{#Text#}</div></div>`;

// --- Copy ---
const copyToClipboard = async () => {
    await writeToClipboard(JSON.stringify(destinationArray));
    resultDisplayCopy.innerText = "Copié !";
};

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
        return `<li class="manual-bubble" draggable="true" data-index="${i}" style="background:${color}" title="${text}">` +
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
document.getElementById("startButton").addEventListener("click", start);
document.getElementById("configKInput").addEventListener("input", updateConfigEstimate);
document.getElementById("configValidateButton").addEventListener("click", validateConfig);
document.getElementById("resultDisplayCopy").addEventListener("click", copyToClipboard);

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
