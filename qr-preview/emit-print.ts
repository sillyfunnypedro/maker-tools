// Emit the printable frame sheets as PDFs at true millimetre scale.
//
// Two sets, per frame size:
//   test  — reference square + circle inside the opening. Photograph one and the
//           export can be measured against known dimensions. These are our
//           calibration sheets: they go to qr-preview/print/ and are NOT shipped.
//   blank — empty opening. Print and draw inside it, or cut the opening out and
//           lay the sheet over something as a physical frame. These are for
//           users, so they emit straight into public/ and get served by the app's
//           download page.
//
// The split is deliberately structural rather than a naming convention: anything
// under public/ ships with the build, anything under qr-preview/ cannot.
//
// Layout (and the reasoning behind the paper choice) lives in
// src/qrframe/printLayout.ts.
//
// Run: npm run emit:print
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { STANDARD_SPECS } from "../src/qrframe/generate";
import { layoutNote, printPageSvg } from "../src/qrframe/printLayout";
import { outerH, outerW } from "../src/qrframe/spec";

const INTERNAL = "qr-preview/print";   // calibration sheets, not published
export const PUBLIC = "public/frames";  // blank sheets, served by the app

const VARIANTS = [
  { name: "test", sample: true, out: INTERNAL },
  { name: "blank", sample: false, out: PUBLIC },
] as const;

for (const variant of VARIANTS) {
  const OUT = variant.out;
  mkdirSync(OUT, { recursive: true });
  mkdirSync(INTERNAL, { recursive: true });
  const pdfs: string[] = [];
  console.log(`\n${variant.name} sheets -> ${OUT}/`);
  for (const spec of STANDARD_SPECS) {
    const layout = printPageSvg(spec, { sample: variant.sample });
    // Intermediate SVGs always stay internal — public/ is copied verbatim into
    // the build, and shipping a stray .svg next to each .pdf would be noise
    // (they're also gitignored, so they'd only exist on this machine).
    const svgPath = `${INTERNAL}/qrframe-${spec.id}-${variant.name}.svg`;
    const pdfPath = `${OUT}/qrframe-${spec.id}-${variant.name}.pdf`;
    writeFileSync(svgPath, layout.svg);
    // rsvg-convert carries the SVG's physical mm size into the PDF page box.
    execFileSync("rsvg-convert", ["-f", "pdf", "-o", pdfPath, svgPath]);
    pdfs.push(pdfPath);
    console.log(
      `  ${pdfPath}\n      frame ${outerW(spec)}×${outerH(spec)} mm, ` +
      `opening ${spec.innerW}×${spec.innerH} mm → ${layoutNote(layout)}`,
    );
  }

  // One combined document per set, like the old frames-print.pdf.
  const all = `${OUT}/qrframes-${variant.name}.pdf`;
  execFileSync("gs", [
    "-dNOPAUSE", "-dBATCH", "-dQUIET", "-sDEVICE=pdfwrite",
    "-dAutoRotatePages=/None", // rotating pages would undo the printed-scale story
    `-sOutputFile=${all}`, ...pdfs,
  ]);
  console.log(`  ${all}  (all ${pdfs.length} sizes, one page each)`);
}
