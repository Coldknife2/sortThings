let startingArray = [];

let setTextLeft = text => document.getElementById("choiceTextLeft").innerText = text;
let setTextRight = text => document.getElementById("choiceTextRight").innerText = text;
let choiceSection = document.getElementById("choiceSection");
let startSection = document.getElementById("startSection");
let resultDisplaySection = document.getElementById("resultDisplaySection");
let resultDisplayCopy = document.getElementById("resultDisplayCopy");
let numberBattleDisplay = document.getElementById("numberBattleDisplay");
let numberBattleMaxDisplay = document.getElementById("numberBattleMaxDisplay");
let completionPercentage = document.getElementById("completionPercentage");

let numberBattles = 0;
let startingNumberToSort = 0;

function start()
{
    createArrayFromInput();
    if(startingArray.length && startingArray.length > 1)
    {
        startingNumberToSort = startingArray.length;
        calculateWorstCaseDichotomicSort(startingArray.length);
        hideInput();

        showChoices();
        initializeChoices();


        numberBattleDisplay.innerText = numberBattles + 1;
        numberBattleMaxDisplay.innerText = sumArray(predictedWorstCase);
        completionPercentage.innerText = Math.floor(destinationArray.length / startingNumberToSort * 100);
    }
}

function createArrayFromInput()
{
    let array = document.getElementById("input").value.split`\n`.filter(t => t!="");
    startingArray = array;
}

function showChoices()
{
    choiceSection.className = choiceSection.className.replace("hidden", "");
}

function showCopyButton()
{
    resultDisplayCopy.className = resultDisplayCopy.className.replace("hidden", "");
}

function hideInput()
{
    startSection.className += " hidden";
}

function load()
{
}

let destinationArray =  [];
let currentEvaluatedChoice;
let lowerBound = null; // Low = good
let higherBound = null; // High = bad
let indexPresentedChoice = null;

function initializeChoices()
{
    destinationArray = [[startingArray.pop()]];
    currentEvaluatedChoice = startingArray.pop();
    setTextLeft(currentEvaluatedChoice);
    indexPresentedChoice = 0;
    setTextRight(destinationArray[0]);
}

function left() // We prefer our thing
{
    higherBound = indexPresentedChoice;
    compute();
}

function right() // We prefer the proposed thing
{
    lowerBound = indexPresentedChoice;
    compute();
}

function choiceFinished()
{
    lowerBound = null;
    higherBound = null;
    indexPresentedChoice = null;
    predictedWorstCase.shift();
    if(startingArray.length > 0)
    {
        currentEvaluatedChoice = startingArray.pop();
        setTextLeft(currentEvaluatedChoice);
    } else {
        console.log("Traitement fini !");
        console.log(destinationArray);
        choiceSection.hidden = true;
        displayResults();
    }
}

function compute()
{
    numberBattles++;
    numberBattleDisplay.innerText = numberBattles + 1;
    if(lowerBound != null && higherBound != null && higherBound - lowerBound == 1)
    {
        // Choix fini
        destinationArray.splice(lowerBound + 1, 0, [currentEvaluatedChoice]);
        choiceFinished();
    }
    if(higherBound == 0)
    {
        // Choix fini, insertion au début
        destinationArray.unshift([currentEvaluatedChoice]);
        choiceFinished();
    }
    if(lowerBound == destinationArray.length - 1)
    {
        // Choix fini, insertion à la fin
        destinationArray.push([currentEvaluatedChoice]);
        choiceFinished();
    }
    let lowestBound = Math.max(lowerBound, 0);
    let highestBound = higherBound != null ? higherBound : destinationArray.length;
    let nextChoice = lowestBound + Math.floor( Math.abs(highestBound - lowestBound) / 2 );
    indexPresentedChoice = nextChoice;
    setTextRight(destinationArray[indexPresentedChoice]);
    predictedWorstCase[0]--;
    numberBattleMaxDisplay.innerText = sumArray(predictedWorstCase);
    completionPercentage.innerText = Math.floor(destinationArray.length / startingNumberToSort * 100);
}

function displayResults()
{
    showCopyButton();
    let result = destinationArray.map((value, index) => {
        let toAppend = templateResultWhiteCase;
        if(index < 3)
        {
            toAppend = templateResultTop3Case;
        }
        if(index == 0)
        {
            toAppend = templateResultBestCase;
        }
        return toAppend.replace("{#Number#}", index + 1).replace("{#Text#}", value);
    });
    resultDisplaySection.innerHTML = result.join("");
}

const templateResultWhiteCase = `<div class="flex flex-auto place-items-center border-2 border-black py-2 px-4 rounded m-4 text-center">
<div class="inline-block pr-2 mr-2 border-r-2 border-black">{#Number#}</div>
<div class="inline-block whitespace-pre-wrap">{#Text#}</div></div>`;

const templateResultBestCase = `<div class="flex flex-auto place-items-center border-2 border-black bg-yellow-600 py-2 px-4 rounded m-4 text-white text-center">
<div class="inline-block pr-2 mr-2 border-r-2 border-black"><svg class="w-12" x="0px" y="0px" viewBox="0 0 130 130"><g><path
    d="m 64.000012,31.484944 28.902346,36.127871 28.902242,-36.127871 -7.22553,65.030147 -101.158086,0 L 6.1954237,31.484944 35.0977,67.612815 64.000012,31.484944 z"
    style="fill:#ffcd00;fill-opacity:1;fill-rule:evenodd;stroke:#000000;stroke-width:4.33534527;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-opacity:1;stroke-dasharray:none"/></g></svg></div>
<div class="inline-block whitespace-pre-wrap">{#Text#}</div></div>`;

const templateResultTop3Case = `<div class="flex flex-auto place-items-center border-2 border-black bg-green-700 py-2 px-4 rounded m-4 text-white text-center">
<div class="inline-block pr-2 mr-2 border-r-2 border-black">{#Number#}</div>
<div class="inline-block whitespace-pre-wrap">{#Text#}</div></div>`;

const copyToClipboard = () => {
    const el = document.createElement('textarea');
    el.value = JSON.stringify(destinationArray);
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    resultDisplayCopy.innerText = "Copié !";
  };

let predictedWorstCase = [];

function calculateWorstCaseDichotomicSort(n) {
    predictedWorstCase = new Array(n-1).fill(0).map((v,i) => 1+Math.ceil(Math.log(i+1) / Math.log(2)));
}

function sumArray(array) 
{
    return array.reduce((a,v)=>a+v,0);
}