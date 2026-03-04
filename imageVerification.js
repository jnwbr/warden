const sharp = require('sharp');
const Tesseract = require('tesseract.js');

const COOLDOWN_MS = 30000; // 30 seconds between image submissions per user
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

const userCooldowns = new Map();

// Tesseract worker (reused across calls for performance)
let tesseractWorker = null;

async function initWorker() {
    if (tesseractWorker) return tesseractWorker;
    tesseractWorker = await Tesseract.createWorker('eng');
    console.log('Tesseract OCR worker initialized');
    return tesseractWorker;
}

function checkCooldown(userId) {
    const lastSubmission = userCooldowns.get(userId);
    if (!lastSubmission) return { limited: false, remainingMs: 0 };
    const elapsed = Date.now() - lastSubmission;
    if (elapsed < COOLDOWN_MS) {
        return { limited: true, remainingMs: COOLDOWN_MS - elapsed };
    }
    return { limited: false, remainingMs: 0 };
}

function setCooldown(userId) {
    userCooldowns.set(userId, Date.now());
}

/**
 * Download and preprocess an image for OCR.
 * Resizes to max 1920px wide, converts to grayscale, boosts contrast.
 */
async function preprocessImage(imageUrl) {
    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error(`Failed to download image: HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Resize, convert to grayscale, normalize contrast for better OCR
    const processed = await sharp(buffer)
        .resize(1920, null, { withoutEnlargement: true })
        .grayscale()
        .normalize()
        .sharpen()
        .png()
        .toBuffer();

    return processed;
}

/**
 * Run OCR on the full image and try to extract a WoW character name.
 * Returns { characterName: string | null, confidence: string, allText: string }
 */
async function extractCharacterName(imageBuffer) {
    const worker = await initWorker();

    const { data } = await worker.recognize(imageBuffer);
    const fullText = data.text;

    console.log('[OCR] Extracted text length:', fullText.length);

    // WoW character names: 2-12 characters, start with uppercase, only letters
    // They typically appear near level/class info
    // Patterns to look for:
    //   "Name" (standalone capitalized word)
    //   "Name - Level XX ClassName"
    //   "Lv XX Name"
    //   "Name  Level 60  Warrior"

    let characterName = null;
    let confidence = 'low';

    // Pattern 1: "Name - Level XX ClassName" or "Name Level XX ClassName"
    const levelPattern = /\b([A-Z][a-z]{1,11})\s*[-—]?\s*(?:Level|Lv|Lvl)\s*(\d{1,2})\s*(Warrior|Paladin|Hunter|Rogue|Priest|Shaman|Mage|Warlock|Druid)/i;
    let match = fullText.match(levelPattern);
    if (match) {
        characterName = match[1];
        confidence = 'high';
        console.log(`[OCR] Found name via level pattern: ${characterName} (Level ${match[2]} ${match[3]})`);
        return { characterName, confidence, allText: fullText };
    }

    // Pattern 2: Just "Level XX" near a capitalized name
    const levelNearNamePattern = /\b([A-Z][a-z]{1,11})\b[\s\S]{0,30}(?:Level|Lv|Lvl)\s*(\d{1,2})/i;
    match = fullText.match(levelNearNamePattern);
    if (match) {
        characterName = match[1];
        confidence = 'medium';
        console.log(`[OCR] Found name near level text: ${characterName}`);
        return { characterName, confidence, allText: fullText };
    }

    // Pattern 3: Reverse - "Level XX" then name
    const reverseLevelPattern = /(?:Level|Lv|Lvl)\s*(\d{1,2})[\s\S]{0,30}\b([A-Z][a-z]{1,11})\b/i;
    match = fullText.match(reverseLevelPattern);
    if (match) {
        const potentialName = match[2];
        // Filter out common WoW UI words
        const uiWords = ['level', 'health', 'mana', 'energy', 'rage', 'power', 'armor', 'damage', 'attack', 'defense', 'spell', 'quest', 'guild', 'party', 'raid', 'chat', 'general', 'trade', 'combat', 'target', 'player', 'character', 'inventory', 'equipment', 'talents', 'skills', 'reputation', 'honor', 'arena', 'battleground'];
        if (!uiWords.includes(potentialName.toLowerCase())) {
            characterName = potentialName;
            confidence = 'medium';
            console.log(`[OCR] Found name after level text: ${characterName}`);
            return { characterName, confidence, allText: fullText };
        }
    }

    // Pattern 4: Class name near a capitalized word (character panel)
    const classPattern = /\b([A-Z][a-z]{1,11})\b[\s\S]{0,20}\b(Warrior|Paladin|Hunter|Rogue|Priest|Shaman|Mage|Warlock|Druid)\b/i;
    match = fullText.match(classPattern);
    if (match) {
        const potentialName = match[1];
        const uiWords = ['level', 'health', 'mana', 'energy', 'rage', 'power', 'armor', 'damage', 'attack', 'defense', 'spell', 'quest', 'guild', 'night', 'blood', 'human', 'dwarf', 'gnome', 'tauren', 'troll', 'undead', 'melee', 'ranged'];
        if (!uiWords.includes(potentialName.toLowerCase())) {
            characterName = potentialName;
            confidence = 'medium';
            console.log(`[OCR] Found name near class name: ${characterName} (${match[2]})`);
            return { characterName, confidence, allText: fullText };
        }
    }

    console.log('[OCR] Could not extract character name from text');
    return { characterName: null, confidence: 'low', allText: fullText };
}

/**
 * Analyze gear quality by pixel colors in the image.
 * WoW item quality colors:
 *   Poor:      #9D9D9D (grey)
 *   Common:    #FFFFFF (white)
 *   Uncommon:  #1EFF00 (green)
 *   Rare:      #0070DD (blue)
 *   Epic:      #A335EE (purple)
 *   Legendary: #FF8000 (orange)
 *
 * Returns { overallQuality, epicCount, rareCount, uncommonCount, totalColoredPixels }
 */
async function analyzeGearColors(imageUrl) {
    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error(`Failed to download image: HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Resize for faster processing, keep color
    const { data: pixels, info } = await sharp(buffer)
        .resize(800, null, { withoutEnlargement: true })
        .raw()
        .toBuffer({ resolveWithObject: true });

    const { width, height, channels } = info;
    let epicCount = 0;
    let rareCount = 0;
    let uncommonCount = 0;
    let legendaryCount = 0;

    // Scan pixels and count quality-colored ones
    for (let i = 0; i < pixels.length; i += channels) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];

        // Epic purple: high red, low green, high blue (around #A335EE)
        if (r > 130 && r < 200 && g < 80 && b > 180) {
            epicCount++;
        }
        // Rare blue: low red, medium green, high blue (around #0070DD)
        else if (r < 40 && g > 80 && g < 140 && b > 180) {
            rareCount++;
        }
        // Uncommon green: low red, high green, low blue (around #1EFF00)
        else if (r < 80 && g > 200 && b < 60) {
            uncommonCount++;
        }
        // Legendary orange: high red, medium green, low blue (around #FF8000)
        else if (r > 220 && g > 100 && g < 160 && b < 40) {
            legendaryCount++;
        }
    }

    const totalPixels = width * height;
    const totalColored = epicCount + rareCount + uncommonCount + legendaryCount;

    // Determine overall quality based on which color dominates
    let overallQuality = 'unknown';
    if (totalColored < totalPixels * 0.001) {
        overallQuality = 'unknown'; // Too few colored pixels to determine
    } else if (legendaryCount > epicCount && legendaryCount > rareCount) {
        overallQuality = 'legendary';
    } else if (epicCount > rareCount && epicCount > uncommonCount) {
        overallQuality = 'excellent';
    } else if (rareCount > uncommonCount) {
        overallQuality = 'good';
    } else if (uncommonCount > 0) {
        overallQuality = 'average';
    } else {
        overallQuality = 'poor';
    }

    return {
        overallQuality,
        epicCount: Math.round(epicCount / 100), // Rough "cluster" count
        rareCount: Math.round(rareCount / 100),
        uncommonCount: Math.round(uncommonCount / 100),
        legendaryCount: Math.round(legendaryCount / 100),
        totalColoredPixels: totalColored,
        totalPixels
    };
}

module.exports = {
    initWorker,
    checkCooldown,
    setCooldown,
    preprocessImage,
    extractCharacterName,
    analyzeGearColors,
    ALLOWED_TYPES,
    MAX_FILE_SIZE
};
