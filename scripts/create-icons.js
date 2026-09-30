const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Minimal pure-JS PNG encoder
function createPNG(width, height, pixelFn) {
    const rawData = Buffer.alloc(height * (width * 4 + 1));
    let offset = 0;

    for (let y = 0; y < height; y++) {
        rawData[offset++] = 0; // Filter: None
        for (let x = 0; x < width; x++) {
            const [r, g, b, a] = pixelFn(x, y, width, height);
            rawData[offset++] = r;
            rawData[offset++] = g;
            rawData[offset++] = b;
            rawData[offset++] = a;
        }
    }

    const compressed = zlib.deflateSync(rawData);

    // PNG Signature
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    // IHDR
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr.writeUInt8(8, 8); // 8-bit
    ihdr.writeUInt8(6, 9); // RGBA
    ihdr.writeUInt8(0, 10);
    ihdr.writeUInt8(0, 11);
    ihdr.writeUInt8(0, 12);

    const makeChunk = (type, data) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length, 0);
        const typeBuf = Buffer.from(type, 'ascii');
        const toCrc = Buffer.concat([typeBuf, data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(toCrc), 0);
        return Buffer.concat([len, typeBuf, data, crc]);
    };

    const iend = Buffer.alloc(0);

    return Buffer.concat([
        sig,
        makeChunk('IHDR', ihdr),
        makeChunk('IDAT', compressed),
        makeChunk('IEND', iend)
    ]);
}

function crc32(buf) {
    let c = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
        c ^= buf[n];
        for (let k = 0; k < 8; k++) {
            c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
        }
    }
    return (c ^ 0xffffffff) >>> 0;
}

// Distance helper
function dist(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
}

// Modern LAMPS App Icon (256x256)
// Features: Rounded squircle badge with dark blue gradient, luminous golden-amber Lamp/Lantern & stack layers
function lampsIconPixel(x, y, w, h) {
    const cx = w / 2;
    const cy = h / 2;

    // Squircle container bounds
    const pad = w * 0.08;
    const innerW = w - 2 * pad;
    const radius = w * 0.22;

    const clampX = Math.max(pad + radius, Math.min(x, w - pad - radius));
    const clampY = Math.max(pad + radius, Math.min(y, h - pad - radius));
    const dCorner = dist(x, y, clampX, clampY);

    if (dCorner > radius) {
        return [0, 0, 0, 0]; // Transparent background
    }

    // Border highlight
    if (dCorner >= radius - 2 && dCorner <= radius) {
        return [56, 189, 248, 180]; // Cyan highlight edge
    }

    // Base background: Deep sleek navy / indigo gradient
    const t = y / h;
    let bgR = Math.round(15 + t * 12);
    let bgG = Math.round(23 + t * 15);
    let bgB = Math.round(42 + t * 25);

    // Warm radial glow from the lamp light center (cx, h * 0.40)
    const lightSourceY = h * 0.38;
    const dLight = dist(x, y, cx, lightSourceY);
    if (dLight < w * 0.38) {
        const glowFactor = (1 - dLight / (w * 0.38));
        bgR = Math.min(255, Math.round(bgR + glowFactor * 70));
        bgG = Math.min(255, Math.round(bgG + glowFactor * 50));
        bgB = Math.min(255, Math.round(bgB + glowFactor * 10));
    }

    // --- LAMP DRAWING ---
    // 1. Lamp Shade / Dome (Trapezoid from y=0.22 to y=0.36)
    const shadeTopY = h * 0.22;
    const shadeBottomY = h * 0.36;
    if (y >= shadeTopY && y <= shadeBottomY) {
        const prog = (y - shadeTopY) / (shadeBottomY - shadeTopY);
        const halfWidth = (w * 0.12) + prog * (w * 0.20);
        if (Math.abs(x - cx) <= halfWidth) {
            // Gradient on shade
            return [245, 158, 11, 255]; // Warm golden amber
        }
        // Outline
        if (Math.abs(x - cx) <= halfWidth + 1.5) {
            return [251, 191, 36, 255];
        }
    }

    // 2. Glowing Lamp Bulb / Light Core (Semi-circle under shade)
    if (y > shadeBottomY && y <= shadeBottomY + h * 0.12) {
        const bulbDist = dist(x, y, cx, shadeBottomY + h * 0.03);
        if (bulbDist <= w * 0.11) {
            // Bright white-gold core
            return [254, 243, 199, 255];
        }
        if (bulbDist <= w * 0.13) {
            return [251, 191, 36, 230];
        }
    }

    // 3. Lamp Neck / Stand (Vertical cylinder)
    const standTopY = shadeBottomY + h * 0.10;
    const standBottomY = h * 0.65;
    if (y >= standTopY && y <= standBottomY) {
        if (Math.abs(x - cx) <= w * 0.03) {
            return [203, 213, 225, 255]; // Brushed silver neck
        }
    }

    // 4. Server Stack Base (Three sleek horizontal layers representing LAMPS stack)
    // Layer 1
    const l1Y = h * 0.66;
    const l1H = h * 0.055;
    if (y >= l1Y && y <= l1Y + l1H && Math.abs(x - cx) <= w * 0.22) {
        if (x <= cx - w * 0.15) return [16, 185, 129, 255]; // Green status LED
        return [30, 41, 59, 255];
    }
    // Layer 2
    const l2Y = h * 0.73;
    const l2H = h * 0.055;
    if (y >= l2Y && y <= l2Y + l2H && Math.abs(x - cx) <= w * 0.25) {
        if (x <= cx - w * 0.18) return [56, 189, 248, 255]; // Cyan status LED
        return [30, 41, 59, 255];
    }
    // Layer 3 (Base foundation)
    const l3Y = h * 0.80;
    const l3H = h * 0.055;
    if (y >= l3Y && y <= l3Y + l3H && Math.abs(x - cx) <= w * 0.28) {
        if (x <= cx - w * 0.21) return [245, 158, 11, 255]; // Amber status LED
        return [51, 65, 85, 255];
    }

    return [bgR, bgG, bgB, 255];
}

// Tray Icon (32x32) - Clean glowing Lamp / Lantern silhouette
function lampsTrayPixel(x, y, w, h) {
    const cx = w / 2;
    
    // Top cap
    if (y >= 4 && y <= 6 && Math.abs(x - cx) <= 3) {
        return [245, 158, 11, 255];
    }

    // Lamp shade
    if (y >= 7 && y <= 14) {
        const prog = (y - 7) / 7;
        const hw = 4 + prog * 6;
        if (Math.abs(x - cx) <= hw) {
            return [251, 191, 36, 255];
        }
    }

    // Glowing core
    if (y >= 15 && y <= 19) {
        const d = dist(x, y, cx, 16);
        if (d <= 4) {
            return [255, 255, 255, 255]; // White glowing center
        }
        if (d <= 6) {
            return [251, 191, 36, 220];
        }
    }

    // Stem
    if (y >= 20 && y <= 24 && Math.abs(x - cx) <= 1) {
        return [226, 232, 240, 255];
    }

    // Base plate
    if (y >= 25 && y <= 27 && Math.abs(x - cx) <= 8) {
        return [56, 189, 248, 255]; // Cyan base
    }

    return [0, 0, 0, 0];
}

function ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

const iconsDir = path.join(__dirname, '..', 'assets', 'icons');
const trayDir = path.join(__dirname, '..', 'assets', 'tray');
ensureDir(iconsDir);
ensureDir(trayDir);

// Generate 256x256 icon
const iconPng = createPNG(256, 256, lampsIconPixel);
fs.writeFileSync(path.join(iconsDir, 'icon.png'), iconPng);

// Generate 32x32 tray icon
const trayPng = createPNG(32, 32, lampsTrayPixel);
fs.writeFileSync(path.join(trayDir, 'tray.png'), trayPng);

// Minimal ICO wrapper containing the 256x256 PNG
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);

const icoDirEntry = Buffer.alloc(16);
icoDirEntry.writeUInt8(0, 0); // 256 -> 0
icoDirEntry.writeUInt8(0, 1); // 256 -> 0
icoDirEntry.writeUInt8(0, 2);
icoDirEntry.writeUInt8(0, 3);
icoDirEntry.writeUInt16LE(1, 4);
icoDirEntry.writeUInt16LE(32, 6);
icoDirEntry.writeUInt32LE(iconPng.length, 8);
icoDirEntry.writeUInt32LE(22, 12);

const icoData = Buffer.concat([icoHeader, icoDirEntry, iconPng]);
fs.writeFileSync(path.join(iconsDir, 'icon.ico'), icoData);

console.log('Successfully generated LAMPS icon.png, icon.ico, and tray.png');
