#!/usr/bin/env node

/**
 * Generate macOS (.icns) and Windows (.ico) icons from a source PNG
 *
 * This script creates properly formatted app icons for:
 * - macOS: .icns with proper rounded corners (squircle shape)
 * - Windows: .ico with multiple sizes
 *
 * Based on Apple's macOS Big Sur icon guidelines:
 * - 1024x1024 canvas
 * - 824x824 content area (centered)
 * - ~22% corner radius for content area
 * - 100px transparent padding on all sides
 */

import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const BUILD_DIR = join(__dirname, '../build');
const INPUT_ICON = join(BUILD_DIR, 'icon.png');
const ICONSET_DIR = join(BUILD_DIR, 'icon.iconset');
const OUTPUT_ICNS = join(BUILD_DIR, 'icon.icns');
const OUTPUT_ICO = join(BUILD_DIR, 'icon.ico');

// macOS icon specifications
const ICNS_SIZES = [
  { size: 16, scale: 1 },
  { size: 16, scale: 2 },
  { size: 32, scale: 1 },
  { size: 32, scale: 2 },
  { size: 128, scale: 1 },
  { size: 128, scale: 2 },
  { size: 256, scale: 1 },
  { size: 256, scale: 2 },
  { size: 512, scale: 1 },
  { size: 512, scale: 2 },
];

// Windows ICO sizes (multiple sizes for proper taskbar rendering)
// 16, 32, 48 are essential for Windows taskbar and file explorer
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * Create an SVG rounded rectangle path (Apple's squircle approximation)
 */
function createRoundedRectSVG(width, height, radius) {
  return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="white"/>
    </svg>
  `;
}

/**
 * Create a rounded squircle icon following Apple's design guidelines
 * 
 * For older macOS (pre-Sequoia), icons need padding to look correct in Dock.
 * Apple recommends: 1024x1024 canvas with ~824x824 content area (100px padding).
 */
async function createRoundedSquircle(inputPath, outputPath, size = 1024, padding = 100) {
  const contentSize = size - (padding * 2); // 824 for 1024 canvas
  const contentCornerRadius = Math.round(contentSize * 0.22); // ~22% for content area

  console.log(`   • Processing: ${size}x${size} canvas`);
  console.log(`   • Content area: ${contentSize}x${contentSize}`);
  console.log(`   • Content corner radius: ${contentCornerRadius}px`);
  console.log(`   • Padding: ${padding}px on all sides`);

  // Create rounded rectangle mask for the CONTENT area (not full canvas)
  const maskSVG = createRoundedRectSVG(contentSize, contentSize, contentCornerRadius);
  const maskBuffer = Buffer.from(maskSVG);

  // Step 1: Resize input to content size and apply rounded mask
  const maskedContent = await sharp(inputPath)
    .resize(contentSize, contentSize, { fit: 'cover' })
    .composite([
      {
        input: maskBuffer,
        blend: 'dest-in'
      }
    ])
    .png()
    .toBuffer();

  // Step 2: Place masked content centered on transparent canvas with padding
  const result = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([
      {
        input: maskedContent,
        left: padding,
        top: padding
      }
    ])
    .png()
    .toBuffer();

  await sharp(result).toFile(outputPath);

  return outputPath;
}

/**
 * Generate a specific icon size
 */
async function generateIconSize(sourcePath, size, scale, outputDir) {
  const actualSize = size * scale;
  const filename = scale === 1
    ? `icon_${size}x${size}.png`
    : `icon_${size}x${size}@${scale}x.png`;

  const outputPath = join(outputDir, filename);

  await sharp(sourcePath)
    .resize(actualSize, actualSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outputPath);

  return { filename, actualSize };
}

/**
 * Trim transparent borders from image
 * Essential for Windows icons to prevent white border artifacts
 */
async function trimTransparentBorders(sourcePath) {
  const image = sharp(sourcePath);
  const { width, height } = await image.metadata();

  console.log(`   • Original size: ${width}x${height}`);

  // Get raw pixel data
  const { data } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Find boundaries of non-transparent pixels
  let minX = width, minY = height, maxX = 0, maxY = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 10) { // threshold for "visible" pixels
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  // Add small padding
  const padding = 2;
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(width - 1, maxX + padding);
  maxY = Math.min(height - 1, maxY + padding);

  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;

  console.log(`   • Trimmed size: ${cropWidth}x${cropHeight} (removed ${width - cropWidth}px borders)`);

  // Crop to content bounds
  return sharp(sourcePath)
    .extract({
      left: minX,
      top: minY,
      width: cropWidth,
      height: cropHeight
    })
    .toBuffer();
}

/**
 * Generate Windows .ico file with transparent borders trimmed
 * ICO format: header + directory entries + image data (PNG format)
 */
async function generateIco(sourcePath, outputPath) {
  console.log('\n🪟 Generating Windows ICO file...');
  console.log('   Trimming transparent borders...');

  // Trim transparent borders first
  const trimmedBuffer = await trimTransparentBorders(sourcePath);

  const images = [];

  // Generate PNG buffers for each size from trimmed image
  for (const size of ICO_SIZES) {
    const buffer = await sharp(trimmedBuffer)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    images.push({ size, data: buffer });
    console.log(`   ✓ Generated ${size}x${size} PNG`);
  }

  // Build ICO file
  // ICO Header: 6 bytes
  const headerSize = 6;
  const dirEntrySize = 16;
  const numImages = images.length;

  // Calculate total size
  let dataOffset = headerSize + (dirEntrySize * numImages);
  const buffers = [];

  // ICO Header
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // Reserved
  header.writeUInt16LE(1, 2);      // Type: 1 = ICO
  header.writeUInt16LE(numImages, 4); // Number of images
  buffers.push(header);

  // Directory entries
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size < 256 ? size : 0, 0);   // Width (0 = 256)
    entry.writeUInt8(size < 256 ? size : 0, 1);   // Height (0 = 256)
    entry.writeUInt8(0, 2);                        // Color palette
    entry.writeUInt8(0, 3);                        // Reserved
    entry.writeUInt16LE(1, 4);                     // Color planes
    entry.writeUInt16LE(32, 6);                    // Bits per pixel
    entry.writeUInt32LE(data.length, 8);           // Image size
    entry.writeUInt32LE(dataOffset, 12);           // Image offset
    buffers.push(entry);
    dataOffset += data.length;
  }

  // Image data
  for (const { data } of images) {
    buffers.push(data);
  }

  // Write ICO file
  const icoBuffer = Buffer.concat(buffers);
  writeFileSync(outputPath, icoBuffer);

  console.log(`   ✓ Created ${outputPath.split('/').pop()} (with trimmed borders)`);
}

async function main() {
  console.log('🎨 Generating app icons (macOS .icns + Windows .ico)...\n');

  // Check input file
  if (!existsSync(INPUT_ICON)) {
    console.error(`❌ Error: Input icon not found at ${INPUT_ICON}`);
    process.exit(1);
  }

  console.log(`📂 Input:  ${INPUT_ICON}`);
  console.log(`📂 Output: ${OUTPUT_ICNS}, ${OUTPUT_ICO}\n`);

  // Create iconset directory
  if (existsSync(ICONSET_DIR)) {
    rmSync(ICONSET_DIR, { recursive: true });
  }
  mkdirSync(ICONSET_DIR, { recursive: true });

  // ═══════════════════════════════════════════════════════════════
  // Step 1: Generate macOS .icns
  // ═══════════════════════════════════════════════════════════════
  console.log('🍎 Generating macOS ICNS file...');
  console.log('   Trimming transparent borders...');

  // Trim transparent borders from source icon first
  const trimmedMacBuffer = await trimTransparentBorders(INPUT_ICON);

  console.log('1️⃣  Generating all required icon sizes...');

  for (const { size, scale } of ICNS_SIZES) {
    const actualSize = size * scale;
    const filename = scale === 1
      ? `icon_${size}x${size}.png`
      : `icon_${size}x${size}@${scale}x.png`;

    const outputPath = join(ICONSET_DIR, filename);

    // Generate from trimmed buffer instead of original file
    await sharp(trimmedMacBuffer)
      .resize(actualSize, actualSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(outputPath);

    console.log(`   ✓ ${filename} (${actualSize}x${actualSize})`);
  }

  // Create .icns file
  console.log('\n3️⃣  Creating .icns file...');

  try {
    execSync(`iconutil -c icns "${ICONSET_DIR}" -o "${OUTPUT_ICNS}"`, { stdio: 'pipe' });
    console.log(`   ✓ Created ${OUTPUT_ICNS.split('/').pop()}`);

    // Clean up iconset directory
    rmSync(ICONSET_DIR, { recursive: true });

  } catch (error) {
    console.error('\n❌ Error creating .icns file:', error.message);
    console.error('   Make sure you\'re running on macOS with iconutil available');
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════
  // Step 2: Generate Windows .ico (uses original square icon)
  // ═══════════════════════════════════════════════════════════════
  await generateIco(INPUT_ICON, OUTPUT_ICO);

  // ═══════════════════════════════════════════════════════════════
  // Done!
  // ═══════════════════════════════════════════════════════════════
  console.log('\n✅ Success! Icons generated:');
  console.log(`   • ${OUTPUT_ICNS} (macOS)`);
  console.log(`   • ${OUTPUT_ICO} (Windows)`);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
