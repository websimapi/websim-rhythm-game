import MidiFile from 'midifile';

// --- DOM Elements ---
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const playButton = document.getElementById('play-button');
const loadingText = document.getElementById('loading-text');
const startScreen = document.getElementById('start-screen');
const scoreDisplay = document.getElementById('score-display');
const scoreEl = document.getElementById('score');
const comboDisplay = document.getElementById('combo-display');

// --- Game Constants ---
const LANE_COUNT = 4;
const NOTE_HEIGHT = 30;
const HIT_POSITION_Y_PERCENT = 85; // 85% from the top
const SCROLL_SPEED = 0.5; // pixels per millisecond

// Hit windows in milliseconds
const HIT_WINDOWS = {
    PERFECT: 50,
    GOOD: 100,
    OK: 150,
};

const SCORES = {
    PERFECT: 100,
    GOOD: 50,
    OK: 25,
    MISS: 0
};

// --- Game State ---
let audioContext, audioBuffer, tapBuffer;
let gameStartTime = 0;
let notes = [];
let lanes = [];
let score = 0;
let combo = 0;
let isPlaying = false;
let animationFrameId;

// --- Asset Loading ---
async function loadAssets() {
    window.AudioContext = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContext();

    const [songResponse, tapResponse, midiResponse] = await Promise.all([
        fetch('assets/song.mp3'),
        fetch('assets/tap.mp3'),
        fetch('assets/song.mid')
    ]);

    const [songData, tapData, midiData] = await Promise.all([
        songResponse.arrayBuffer(),
        tapResponse.arrayBuffer(),
        midiResponse.arrayBuffer()
    ]);

    [audioBuffer, tapBuffer] = await Promise.all([
        audioContext.decodeAudioData(songData),
        audioContext.decodeAudioData(tapData)
    ]);

    parseMidi(midiData);

    loadingText.style.display = 'none';
    playButton.style.display = 'block';
}

// --- MIDI Parsing ---
function parseMidi(midiData) {
    const midi = new MidiFile(midiData);
    let currentTime = 0;

    midi.getEvents().forEach(event => {
        currentTime += event.delta * (midi.header.getTicksPerBeat() / 1000);
        if (event.subtype === 'noteOn') {
            const lane = event.noteNumber % LANE_COUNT;
            notes.push({
                time: currentTime, // in ms
                lane: lane,
                hit: false,
                missed: false,
            });
        }
    });
}

// --- Game Setup ---
function setup() {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    playButton.addEventListener('click', startGame);

    canvas.addEventListener('touchstart', handleInput, { passive: false });
    canvas.addEventListener('mousedown', handleInput, { passive: false });
}

function resizeCanvas() {
    canvas.width = Math.min(window.innerWidth, 500);
    canvas.height = window.innerHeight;

    lanes = [];
    const laneWidth = canvas.width / LANE_COUNT;
    for (let i = 0; i < LANE_COUNT; i++) {
        lanes.push({ x: i * laneWidth, w: laneWidth });
    }
}

// --- Game Logic ---
function startGame() {
    startScreen.style.display = 'none';
    scoreDisplay.style.display = 'block';

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.start(0);

    gameStartTime = audioContext.currentTime * 1000;
    isPlaying = true;
    score = 0;
    combo = 0;
    updateScore();

    animationFrameId = requestAnimationFrame(gameLoop);
}

function gameLoop() {
    if (!isPlaying) return;

    const currentTime = (audioContext.currentTime * 1000) - gameStartTime;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawLanes();
    drawHitLine();
    drawNotes(currentTime);

    animationFrameId = requestAnimationFrame(gameLoop);
}

// --- Drawing ---
function drawLanes() {
    ctx.strokeStyle = '#555';
    lanes.forEach(lane => {
        ctx.strokeRect(lane.x, 0, lane.w, canvas.height);
    });
}

function drawHitLine() {
    const hitY = canvas.height * (HIT_POSITION_Y_PERCENT / 100);
    ctx.strokeStyle = '#4CAF50';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, hitY);
    ctx.lineTo(canvas.width, hitY);
    ctx.stroke();
    ctx.lineWidth = 1;
}

function drawNotes(currentTime) {
    const hitY = canvas.height * (HIT_POSITION_Y_PERCENT / 100);
    const noteColors = ['#FF5733', '#33FF57', '#3357FF', '#FFFF33'];

    notes.forEach(note => {
        if (note.hit || note.missed) return;

        const timeUntilHit = note.time - currentTime;
        const y = hitY - (timeUntilHit * SCROLL_SPEED);

        // Check for misses
        if (y > canvas.height + NOTE_HEIGHT) {
            note.missed = true;
            combo = 0;
            updateComboDisplay();
            return;
        }

        // Only draw notes that are on screen
        if (y > -NOTE_HEIGHT && y < canvas.height + NOTE_HEIGHT) {
            const lane = lanes[note.lane];
            ctx.fillStyle = noteColors[note.lane];
            ctx.fillRect(lane.x, y - NOTE_HEIGHT / 2, lane.w, NOTE_HEIGHT);
        }
    });
}

// --- Input Handling ---
function handleInput(event) {
    event.preventDefault();
    if (!isPlaying) return;

    const touches = event.changedTouches || [{ clientX: event.clientX, clientY: event.clientY }];
    const rect = canvas.getBoundingClientRect();

    for (let i = 0; i < touches.length; i++) {
        const x = touches[i].clientX - rect.left;
        const laneIndex = Math.floor(x / (canvas.width / LANE_COUNT));
        checkHit(laneIndex);
    }
}

function checkHit(laneIndex) {
    playTapSound();
    const currentTime = (audioContext.currentTime * 1000) - gameStartTime;
    const hitY = canvas.height * (HIT_POSITION_Y_PERCENT / 100);
    let hitDetected = false;

    for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        if (note.lane === laneIndex && !note.hit && !note.missed) {
            const timeDiff = Math.abs(note.time - currentTime);

            if (timeDiff <= HIT_WINDOWS.OK) {
                note.hit = true;
                hitDetected = true;
                let quality = 'OK';
                if (timeDiff <= HIT_WINDOWS.PERFECT) {
                    quality = 'PERFECT';
                } else if (timeDiff <= HIT_WINDOWS.GOOD) {
                    quality = 'GOOD';
                }

                score += SCORES[quality];
                combo++;
                updateScore();
                updateComboDisplay(quality);

                // Only one note can be hit per tap in a lane
                break;
            }
        }
    }

    // If tap didn't hit anything in the window, break combo
    if (!hitDetected) {
         combo = 0;
         updateComboDisplay();
    }
}

// --- UI Updates ---
function updateScore() {
    scoreEl.textContent = score;
}

function updateComboDisplay(quality) {
    comboDisplay.textContent = combo > 1 ? `${combo} COMBO` : '';
    if (quality) {
        comboDisplay.textContent += `\\n${quality}`;
    }
    comboDisplay.style.display = 'block';

    // Animation reset
    comboDisplay.style.animation = 'none';
    void comboDisplay.offsetWidth; // Trigger reflow
    comboDisplay.style.animation = 'pop 0.2s';
}

function playTapSound() {
    const tapSource = audioContext.createBufferSource();
    tapSource.buffer = tapBuffer;
    tapSource.connect(audioContext.destination);
    tapSource.start(0);
}

// --- Initial Load ---
window.addEventListener('load', () => {
    setup();
    loadAssets().catch(err => {
        loadingText.textContent = "Error loading assets.";
        console.error(err);
    });
});