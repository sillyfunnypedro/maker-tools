import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { svgFrame, STANDARD_SPECS } from "../src/qrframe/generate";
for (const id of ["std", "square100"]) {
  const spec = STANDARD_SPECS.find((s) => s.id === id)!;
  const svg = `qr-preview/qrframe-${id}.svg`;
  writeFileSync(svg, svgFrame(spec));
  execFileSync("rsvg-convert", ["-w", "1200", "-b", "white", "-o", `qr-preview/qrframe-${id}.png`, svg]);
  console.log("wrote qr-preview/qrframe-" + id + ".png");
}
