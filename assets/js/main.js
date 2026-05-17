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
function createArrayFromInput() {
    startingArray = document.getElementById("input").value.split("\n").filter(t => t.trim() !== "");
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

// --- Sorting ---
function initializeSorting() {
    numberBattles = 0;
    destinationArray = [[startingArray.pop()]];
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
            const displayText = escapeHtml(truncate(text, 24));
            const fullText = escapeHtml(text);
            parts.push(
                `<div class="flex-none bg-blue-700 text-white rounded-lg text-center w-32 py-2 px-1 select-none" title="${fullText}">` +
                `<div class="text-blue-300 text-xs mb-0.5">#${rank}</div>` +
                `<div class="text-xs leading-tight overflow-hidden" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${displayText}</div>` +
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
    destinationArray.splice(position, 0, [currentEvaluatedChoice]);
    updateProgress();
    nextItem();
}

function updateProgress() {
    document.getElementById('numberBattleDisplay').textContent = numberBattles;
    document.getElementById('numberBattleMaxDisplay').textContent = estimateRemainingInteractions();
    document.getElementById('completionPercentage').textContent =
        Math.floor(destinationArray.length / startingNumberToSort * 100);
}

// --- Results ---
function displayResults() {
    show(resultDisplayCopy);
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
    const text = JSON.stringify(destinationArray);
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
    resultDisplayCopy.innerText = "Copié !";
};

// --- Event listeners ---
document.getElementById("startButton").addEventListener("click", start);
document.getElementById("configKInput").addEventListener("input", updateConfigEstimate);
document.getElementById("configValidateButton").addEventListener("click", validateConfig);
document.getElementById("resultDisplayCopy").addEventListener("click", copyToClipboard);
