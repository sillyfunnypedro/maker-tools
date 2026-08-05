// Offline finger joint pipeline.
// Generates SVG files we can inspect directly without the browser.
//
// Usage: npm run fingers [-- <width> <thickness> <fingerCount> <bitDiameter>]
//   e.g. npm run fingers -- 150 12 7 6.35
//
// Outputs to qr-preview/fingers-result/

import { writeFileSync, mkdirSync } from "node:fs";
import { generateFingerJoint } from "../src/joinery/fingerJoint";
import { pathData } from "../src/joinery/geom";

const width = Number(process.argv[2]) || 150;
const thickness = Number(process.argv[3]) || 12;
const fingerCount = Number(process.argv[4]) || 7;
const bitDiameter = Number(process.argv[5]) || 6.35;
const reliefStyle = (process.argv[6] || "long") as "long" | "short" | "diagonal";

const outDir = "qr-preview/fingers-result";
mkdirSync(outDir, { recursive: true });

console.log(`\nFinger Joint Generator (offline)`);
console.log(`  Width: ${width}mm, Thickness: ${thickness}mm`);
console.log(`  Fingers: ${fingerCount}, Bit: ${bitDiameter}mm`);
console.log(`  Relief style: ${reliefStyle}`);
console.log(`  Output: ${outDir}/\n`);

const result = generateFingerJoint({ width, thickness, fingerCount, bitDiameter, reliefStyle });

console.log(`  Relief radius: ${result.reliefRadius.toFixed(3)}mm`);
console.log(`  Finger width: ${(width / fingerCount).toFixed(2)}mm`);
console.log(`  Min finger width: ${(4 * result.reliefRadius).toFixed(2)}mm`);

// Write the SVGs that the app would download
writeFileSync(`${outDir}/board-A.svg`, result.svgA);
writeFileSync(`${outDir}/board-B.svg`, result.svgB);

// Also write a combined preview without rotation or Shaper encoding —
// just raw path data in a simple SVG so we can see exactly what the geometry is.
const margin = 5;
const totalH = thickness + 20; // base height + thickness
const svgW = width + 60 + 2 * margin; // EXT=30 each side
const svgH = 2 * totalH + 10 + 2 * margin;

// Dump the contour points for inspection
console.log(`\nBoard A contour:`);
const cA = result.notchesA[0];
console.log(`  start: (${cA.start.x.toFixed(2)}, ${cA.start.y.toFixed(2)})`);
let arcCountA = 0;
for (const seg of cA.segs) {
  if (seg.radius != null) {
    arcCountA++;
    console.log(`  ARC to (${seg.end.x.toFixed(2)}, ${seg.end.y.toFixed(2)}) r=${seg.radius.toFixed(3)} ccw=${seg.ccw}`);
  } else {
    console.log(`  line to (${seg.end.x.toFixed(2)}, ${seg.end.y.toFixed(2)})`);
  }
}
console.log(`  Total arcs: ${arcCountA}`);

console.log(`\nBoard B contour:`);
const cB = result.notchesB[0];
console.log(`  start: (${cB.start.x.toFixed(2)}, ${cB.start.y.toFixed(2)})`);
let arcCountB = 0;
for (const seg of cB.segs) {
  if (seg.radius != null) {
    arcCountB++;
    console.log(`  ARC to (${seg.end.x.toFixed(2)}, ${seg.end.y.toFixed(2)}) r=${seg.radius.toFixed(3)} ccw=${seg.ccw}`);
  } else {
    console.log(`  line to (${seg.end.x.toFixed(2)}, ${seg.end.y.toFixed(2)})`);
  }
}
console.log(`  Total arcs: ${arcCountB}`);

const rawA = pathData(result.notchesA[0], 1, 4);
const rawB = pathData(result.notchesB[0], 1, 4);

// Also generate offset versions to verify offset works
const resultOffset = generateFingerJoint({
  width, thickness, fingerCount: fingerCount % 2 === 0 ? fingerCount + 1 : fingerCount,
  bitDiameter, offsetAX: 20, offsetAY: -5, offsetBX: -15, offsetBY: 3,
});

// viewBox covers well beyond the actual coordinate range
const vbX = -50;
const vbY = -40;
const vbW = 280;
const vbH = 60;
const totalVbH = 2 * vbH + 20;

const debugSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${vbW}mm" height="${totalVbH}mm" viewBox="${vbX} ${vbY} ${vbW} ${totalVbH}">
  <!-- Grid -->
  <defs>
    <pattern id="grid10" width="10" height="10" patternUnits="userSpaceOnUse">
      <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#ddd" stroke-width="0.15"/>
    </pattern>
    <pattern id="grid50" width="50" height="50" patternUnits="userSpaceOnUse">
      <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#bbb" stroke-width="0.25"/>
    </pattern>
  </defs>
  <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${totalVbH}" fill="url(#grid10)"/>
  <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${totalVbH}" fill="url(#grid50)"/>
  <!-- Axes -->
  <line x1="${vbX}" y1="0" x2="${vbX + vbW}" y2="0" stroke="#0a0" stroke-width="0.3"/>
  <line x1="0" y1="${vbY}" x2="0" y2="${vbY + totalVbH}" stroke="#0a0" stroke-width="0.3"/>
  <circle cx="0" cy="0" r="1.5" fill="green"/>
  <text x="2" y="-2" font-size="3" fill="green">0,0</text>

  <!-- Board A (blue) — no offset -->
  <path fill="rgba(100,160,255,0.2)" stroke="blue" stroke-width="0.3" d="${rawA}"/>

  <!-- Board B (orange) — no offset, shifted down for display -->
  <g transform="translate(0, ${vbH + 10})">
    <line x1="${vbX}" y1="0" x2="${vbX + vbW}" y2="0" stroke="#0a0" stroke-width="0.2" stroke-dasharray="2,2"/>
    <line x1="0" y1="${vbY}" x2="0" y2="${vbY + totalVbH}" stroke="#0a0" stroke-width="0.2" stroke-dasharray="2,2"/>
    <circle cx="0" cy="0" r="1.5" fill="green"/>
    <path fill="rgba(255,160,100,0.2)" stroke="orange" stroke-width="0.3" d="${rawB}"/>
  </g>
</svg>`;

// Now a verification SVG showing the OFFSET versions on the same grid
const offsetA = pathData(resultOffset.notchesA[0], 1, 4);
const offsetB = pathData(resultOffset.notchesB[0], 1, 4);

// Parse the offset SVGs to extract the translate values — or just render
// the contours at their offset positions directly
const verifyOffsetSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${vbW}mm" height="${totalVbH}mm" viewBox="${vbX} ${vbY} ${vbW} ${totalVbH}">
  <!-- Grid -->
  <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${totalVbH}" fill="url(#grid10)"/>
  <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${totalVbH}" fill="url(#grid50)"/>
  <defs>
    <pattern id="grid10" width="10" height="10" patternUnits="userSpaceOnUse">
      <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#ddd" stroke-width="0.15"/>
    </pattern>
    <pattern id="grid50" width="50" height="50" patternUnits="userSpaceOnUse">
      <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#bbb" stroke-width="0.25"/>
    </pattern>
  </defs>
  <!-- Axes at origin (where anchor sits) -->
  <line x1="${vbX}" y1="0" x2="${vbX + vbW}" y2="0" stroke="#0a0" stroke-width="0.3"/>
  <line x1="0" y1="${vbY}" x2="0" y2="${vbY + totalVbH}" stroke="#0a0" stroke-width="0.3"/>
  <circle cx="0" cy="0" r="1.5" fill="green"/>
  <text x="2" y="-2" font-size="3" fill="green">anchor 0,0</text>

  <!-- Board A offset (+20, -5) shown in blue -->
  <g transform="translate(20, -5)">
    <path fill="rgba(100,160,255,0.2)" stroke="blue" stroke-width="0.3" d="${offsetA}"/>
  </g>
  <!-- Ghost of Board A at origin for reference -->
  <path fill="none" stroke="blue" stroke-width="0.1" stroke-dasharray="1,1" d="${rawA}"/>

  <!-- Board B offset (-15, +3) shown in orange (shifted down for display) -->
  <g transform="translate(0, ${vbH + 10})">
    <line x1="${vbX}" y1="0" x2="${vbX + vbW}" y2="0" stroke="#0a0" stroke-width="0.2" stroke-dasharray="2,2"/>
    <line x1="0" y1="${vbY}" x2="0" y2="${vbY + totalVbH}" stroke="#0a0" stroke-width="0.2" stroke-dasharray="2,2"/>
    <circle cx="0" cy="0" r="1.5" fill="green"/>
    <text x="2" y="-2" font-size="2.5" fill="green">anchor 0,0</text>
    <g transform="translate(-15, 3)">
      <path fill="rgba(255,160,100,0.2)" stroke="orange" stroke-width="0.3" d="${offsetB}"/>
    </g>
    <!-- Ghost at origin -->
    <path fill="none" stroke="orange" stroke-width="0.1" stroke-dasharray="1,1" d="${rawB}"/>
  </g>

  <text x="${vbX + 5}" y="${vbY + 5}" font-size="3" fill="#333">Board A: offset(+20, -5)  |  Board B: offset(-15, +3)</text>
  <text x="${vbX + 5}" y="${vbY + 9}" font-size="2.5" fill="#666">Dashed = original position, solid = offset. Anchor stays at green dot.</text>
</svg>`;

writeFileSync(`${outDir}/debug-raw.svg`, debugSvg);
writeFileSync(`${outDir}/debug-offset.svg`, verifyOffsetSvg);

// Generate comparison of all three relief styles with corner detail grids
const styles = ["long", "short", "diagonal"] as const;
const compareH = 3 * (vbH + 10);

// For the detail view, zoom into one notch corner
const fingerW = width / fingerCount;
const detailCx = fingerW; // first notch right corner x
const detailCy = 0;       // board edge
const detailSize = thickness + 10;

let compareBody = "";
for (let s = 0; s < styles.length; s++) {
  const st = styles[s];
  const r = generateFingerJoint({ width, thickness, fingerCount, bitDiameter, reliefStyle: st });
  const d = pathData(r.notchesA[0], 1, 4);
  const yOff = s * (vbH + 10);
  compareBody += `  <g transform="translate(0, ${yOff})">
    <text x="${vbX + 3}" y="${vbY + 5}" font-size="3" fill="#333">${st}</text>
    <path fill="rgba(100,160,255,0.15)" stroke="blue" stroke-width="0.3" d="${d}"/>
    <circle cx="0" cy="0" r="1" fill="green"/>
  </g>\n`;
}

// Add a zoomed detail SVG showing corners with grid
let detailBody = "";
for (let s = 0; s < styles.length; s++) {
  const st = styles[s];
  const r = generateFingerJoint({ width, thickness, fingerCount, bitDiameter, reliefStyle: st });
  const d = pathData(r.notchesA[0], 1, 4);
  const yOff = s * (detailSize + 5);
  // 1mm grid around the first corner
  let grid = "";
  for (let gx = -5; gx <= detailSize; gx += 1) {
    grid += `<line x1="${gx}" y1="${-5}" x2="${gx}" y2="${detailSize}" stroke="#444" stroke-width="0.05"/>\n`;
  }
  for (let gy = -5; gy <= detailSize; gy += 1) {
    grid += `<line x1="${-5}" y1="${gy}" x2="${detailSize}" y2="${gy}" stroke="#444" stroke-width="0.05"/>\n`;
  }
  // 5mm grid
  for (let gx = -5; gx <= detailSize; gx += 5) {
    grid += `<line x1="${gx}" y1="${-5}" x2="${gx}" y2="${detailSize}" stroke="#888" stroke-width="0.1"/>\n`;
  }
  for (let gy = -5; gy <= detailSize; gy += 5) {
    grid += `<line x1="${-5}" y1="${gy}" x2="${detailSize}" y2="${gy}" stroke="#888" stroke-width="0.1"/>\n`;
  }

  detailBody += `  <g transform="translate(0, ${yOff})">
    <text x="-4" y="-3" font-size="2" fill="#fff">${st} (r=${result.reliefRadius.toFixed(2)}mm)</text>
    ${grid}
    <!-- corner at origin -->
    <g transform="translate(${-detailCx + 5}, ${-detailCy + 5})">
      <path fill="rgba(100,160,255,0.15)" stroke="blue" stroke-width="0.15" d="${d}"/>
    </g>
    <circle cx="5" cy="5" r="0.3" fill="red"/>
    <text x="5.5" y="4.5" font-size="1.2" fill="red">corner</text>
    ${st === "diagonal" ? `
    <!-- Reference circle: center at corner + (-r*cos45, +r*cos45) -->
    <circle cx="${5 - result.reliefRadius * Math.cos(Math.PI/4)}" cy="${5 + result.reliefRadius * Math.cos(Math.PI/4)}" r="${result.reliefRadius}" fill="none" stroke="yellow" stroke-width="0.15" stroke-dasharray="0.5,0.5"/>
    <circle cx="${5 - result.reliefRadius * Math.cos(Math.PI/4)}" cy="${5 + result.reliefRadius * Math.cos(Math.PI/4)}" r="0.2" fill="yellow"/>
    <text x="${5 - result.reliefRadius * Math.cos(Math.PI/4) + 0.5}" y="${5 + result.reliefRadius * Math.cos(Math.PI/4) - 0.5}" font-size="1" fill="yellow">ideal center</text>
    ` : ""}
  </g>\n`;
}

const detailW = detailSize + 10;
const detailH = 3 * (detailSize + 5) + 5;

const compareSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${vbW}mm" height="${compareH}mm" viewBox="${vbX} ${vbY} ${vbW} ${compareH}">
${compareBody}</svg>`;
writeFileSync(`${outDir}/compare-styles.svg`, compareSvg);

const detailSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${detailW * 4}mm" height="${detailH * 4}mm" viewBox="-5 -5 ${detailW} ${detailH}" style="background:#222">
${detailBody}</svg>`;
writeFileSync(`${outDir}/corner-detail.svg`, detailSvg);

console.log(`\nWrote:`);
console.log(`  ${outDir}/board-A.svg (Shaper export)`);
console.log(`  ${outDir}/board-B.svg (Shaper export)`);
console.log(`  ${outDir}/debug-raw.svg (raw geometry on grid)`);
console.log(`  ${outDir}/debug-offset.svg (offset verification on grid)`);
console.log(`  ${outDir}/compare-styles.svg (long vs short vs diagonal)`);
console.log(`    Board A offset: (+20, -5)`);
console.log(`    Board B offset: (-15, +3)`);
