// The printable page must stay a measuring instrument: correct paper size, art
// centred, and — after rendering the page and photographing it at an angle —
// still detectable and still measuring its true millimetre dimensions.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { applyH, type Mat3, type Pt } from "./homography";
import { STANDARD_SPECS } from "./generate";
import { PAPERS, fitPaper, printPageSvg } from "./printLayout";
import { outerH, outerW, samplePointsMm } from "./spec";
import { detectQrFrame } from "./detect";
import { QUADS, warpGray } from "./_testutil";

function hasRsvg(): boolean {
  try { execFileSync("rsvg-convert", ["--version"], { stdio: "ignore" }); return true; }
  catch { return false; }
}

describe("print page layout", () => {
  it("puts every fitting frame on a standard sheet, centred", () => {
    for (const spec of STANDARD_SPECS) {
      const l = printPageSvg(spec);
      const w = outerW(spec), h = outerH(spec);
      if (l.fit) {
        // Page must be a real paper size, in one of its two orientations.
        const p = l.fit.paper;
        expect([`${p.w}x${p.h}`, `${p.h}x${p.w}`]).toContain(`${l.pageW}x${l.pageH}`);
        expect(w).toBeLessThanOrEqual(l.pageW);
        expect(h).toBeLessThanOrEqual(l.pageH);
        expect(l.marginMm).toBeGreaterThan(0);
      } else {
        // Fallback page is exactly the artwork, so it stays true-scale.
        expect(l.pageW).toBe(w);
        expect(l.pageH).toBe(h);
        expect(l.marginMm).toBe(0);
      }
      // Centred: equal space on opposite sides.
      expect(l.dx).toBeCloseTo((l.pageW - w) / 2, 6);
      expect(l.dy).toBeCloseTo((l.pageH - h) / 2, 6);
      // The SVG must declare real millimetres, or the print scale is a lie.
      expect(l.svg).toContain(`width="${l.pageW}mm" height="${l.pageH}mm"`);
      expect(l.svg).toContain(`viewBox="0 0 ${l.pageW} ${l.pageH}"`);
      expect(l.svg).toContain(`translate(${l.dx.toFixed(3)},${l.dy.toFixed(3)})`);
    }
  });

  it("picks the smallest paper that fits, and reports none when nothing does", () => {
    const letter = PAPERS[0];
    expect(fitPaper(100, 100)?.paper.name).toBe("Letter");
    expect(fitPaper(letter.w, letter.h)?.orientation).toBe("portrait");
    // Too wide for Letter portrait but fine turned sideways.
    expect(fitPaper(270, 200)).toMatchObject({ orientation: "landscape" });
    expect(fitPaper(270, 200)?.paper.name).toBe("Letter");
    // Longer than Letter either way -> step up to Legal, not straight to Tabloid.
    expect(fitPaper(300, 200)?.paper.name).toBe("Legal");
    // Too tall to lie sideways on Legal -> Tabloid.
    expect(fitPaper(279, 300)?.paper.name).toBe("Tabloid");
    expect(fitPaper(279, 300)?.orientation).toBe("portrait");
    // Bigger than every paper -> caller must handle it, not get a wrong fit.
    expect(fitPaper(500, 500)).toBeNull();
  });

  it("never scales the art: no mm units survive inside the page coordinate system", () => {
    // A nested mm length would be reinterpreted via CSS pixels and rescale the
    // frame. Only the root <svg> may carry mm.
    for (const spec of STANDARD_SPECS) {
      const body = printPageSvg(spec).svg.replace(/<svg[^>]*>/, "");
      expect(body).not.toMatch(/\d\s*mm/);
    }
  });
});

describe("test vs blank sheets", () => {
  it("puts the reference marks on test sheets and leaves blanks empty", () => {
    for (const spec of STANDARD_SPECS) {
      const test = printPageSvg(spec, { sample: true }).svg;
      const blank = printPageSvg(spec, { sample: false }).svg;
      const { square, circle } = samplePointsMm(spec);
      const side = Math.abs(square[1][0] - square[0][0]);
      const dia = Math.abs(circle[1][0] - circle[0][0]);
      expect(side).toBeCloseTo(spec.scaleMm, 6);
      expect(dia).toBeCloseTo(spec.scaleMm / 2, 6);
      // The reference square is the only rect of side `scaleMm`.
      expect(test).toContain(`width="${spec.scaleMm}" height="${spec.scaleMm}"`);
      expect(blank).not.toContain(`width="${spec.scaleMm}" height="${spec.scaleMm}"`);
      // …and the reference circle the only one of radius scaleMm/4.
      expect(test).toContain(`r="${(spec.scaleMm / 4).toFixed(2)}"`);
      expect(blank).not.toContain(`r="${(spec.scaleMm / 4).toFixed(2)}"`);
      // Blanks keep every registration mark: same opening rect, same dot count.
      const dots = (s: string) => (s.match(/<circle/g) ?? []).length;
      expect(dots(blank)).toBe(dots(test) - 1); // only the reference circle is gone
      expect(blank).toContain(
        `<rect x="${spec.marginL}" y="${spec.marginT}" width="${spec.innerW}" height="${spec.innerH}"`);
      // Page geometry must be identical, or the two sets wouldn't print alike.
      const geom = (s: string) => s.match(/width="[\d.]+mm" height="[\d.]+mm" viewBox="[^"]+"/)![0];
      expect(geom(blank)).toBe(geom(test));
    }
  });
});

describe("page label", () => {
  it("adds a <text> for the label and omits it entirely when there's none", () => {
    const std = STANDARD_SPECS.find((s) => s.id === "std")!;
    const withLabel = printPageSvg(std, { sample: false, label: "Jamie · example.com" }).svg;
    const without = printPageSvg(std, { sample: false }).svg;
    expect(withLabel).toContain("<text");
    expect(withLabel).toContain("Jamie · example.com");
    expect(without).not.toContain("<text");
    // Everything else about the page must stay identical (ignore incidental
    // whitespace left behind by stripping the <text> line).
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    expect(norm(withLabel.replace(/<text[\s\S]*?<\/text>\n?/, ""))).toBe(norm(without));
  });

  it("shrinks the font so a long label can't run off the page", () => {
    const std = STANDARD_SPECS.find((s) => s.id === "std")!;
    const long = "Made by Juancho · sillyfunnypedro.github.io/maker-tools/";
    const layout = printPageSvg(std, { sample: false, label: long });
    const size = Number(layout.svg.match(/font-size="([\d.]+)"/)![1]);
    // Same rough glyph-width estimate the implementation uses, checked against
    // the actual page width rather than re-deriving the exact formula.
    expect(long.length * size * 0.6).toBeLessThanOrEqual(layout.pageW * 0.92 + 0.01);
  });

  it("escapes XML-special characters instead of injecting markup", () => {
    const std = STANDARD_SPECS.find((s) => s.id === "std")!;
    const svg = printPageSvg(std, { sample: false, label: `<script>&"'</script>` }).svg;
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;&amp;&quot;&apos;&lt;/script&gt;");
  });

  it("skips the label rather than overlap the art when there's no margin to hold it", () => {
    // A spec whose outer size exceeds every standard paper gets a page sized to
    // the artwork itself — zero margin, so there's nowhere safe to put text.
    const noRoom = { ...STANDARD_SPECS.find((s) => s.id === "a2")!, innerW: 5000, innerH: 5000 };
    const svg = printPageSvg(noRoom, { sample: false, label: "test" }).svg;
    expect(svg).not.toContain("<text");
  });
});

describe.skipIf(!hasRsvg())("blank sheet round-trip (empty opening still detects)", () => {
  const dir = mkdtempSync(join(tmpdir(), "qrblank-"));
  for (const spec of STANDARD_SPECS) {
    it(`${spec.id}`, () => {
      // Nothing inside the opening: detection must rely only on the QR and the
      // margin dots, which is what makes a draw-your-own sheet usable at all.
      const layout = printPageSvg(spec, { sample: false });
      const ppmm = 6;
      const svgPath = join(dir, `${spec.id}.svg`), pngPath = join(dir, `${spec.id}.png`);
      writeFileSync(svgPath, layout.svg);
      execFileSync("rsvg-convert",
        ["-w", String(Math.round(layout.pageW * ppmm)), "-b", "white", "-o", pngPath, svgPath]);
      const png = PNG.sync.read(readFileSync(pngPath));
      const gray = new Uint8ClampedArray(png.width * png.height);
      for (let i = 0, j = 0; i < gray.length; i++, j += 4)
        gray[i] = (png.data[j] + png.data[j + 1] + png.data[j + 2]) / 3;
      const { rgba, OW, OH } = warpGray(gray, png.width, png.height, QUADS.tilt(png.width, png.height));
      const res = detectQrFrame(rgba, OW, OH);
      expect(res.detected, res.reason).toBe(true);
      expect(res.spec!.id).toBe(spec.id);
      expect(res.spec!.innerW).toBe(spec.innerW);
      expect(res.spec!.innerH).toBe(spec.innerH);
    });
  }
});

describe.skipIf(!hasRsvg())("print page round-trip (page -> rsvg -> photo -> detect)", () => {
  const dir = mkdtempSync(join(tmpdir(), "qrprint-"));

  for (const spec of STANDARD_SPECS) {
    it(`${spec.id} stays detectable and true-size on the page`, () => {
      const layout = printPageSvg(spec);
      const ppmm = 6;
      const svgPath = join(dir, `${spec.id}-page.svg`);
      const pngPath = join(dir, `${spec.id}-page.png`);
      writeFileSync(svgPath, layout.svg);
      execFileSync("rsvg-convert",
        ["-w", String(Math.round(layout.pageW * ppmm)), "-b", "white", "-o", pngPath, svgPath]);

      const png = PNG.sync.read(readFileSync(pngPath));
      const W = png.width, H = png.height;
      const gray = new Uint8ClampedArray(W * H);
      for (let i = 0, j = 0; i < gray.length; i++, j += 4)
        gray[i] = (png.data[j] + png.data[j + 1] + png.data[j + 2]) / 3;
      // Pixels per mm as actually rendered, including the page (not the frame).
      const actualPpmm = W / layout.pageW;

      const { rgba, OW, OH, baseToPhoto } = warpGray(gray, W, H, QUADS.tilt(W, H));
      const res = detectQrFrame(rgba, OW, OH);
      expect(res.detected, res.reason).toBe(true);
      expect(res.spec!.id).toBe(spec.id);

      // Sample marks are specified in frame coords; on the page they are shifted
      // by (dx, dy). Measuring them through the detector's homography checks the
      // whole chain: page layout -> render -> perspective -> detected scale.
      const mmToPhoto = (p: Pt): Pt =>
        applyH(baseToPhoto as Mat3, [(p[0] + layout.dx) * actualPpmm, (p[1] + layout.dy) * actualPpmm]);
      const { square, circle } = samplePointsMm(spec);
      const sq = square.map((p) => applyH(res.Hpx2mm!, mmToPhoto(p)));
      const ci = circle.map((p) => applyH(res.Hpx2mm!, mmToPhoto(p)));
      const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
      const w = (dist(sq[0], sq[1]) + dist(sq[3], sq[2])) / 2;
      const h = (dist(sq[0], sq[3]) + dist(sq[1], sq[2])) / 2;
      const dia = (dist(ci[0], ci[1]) + dist(ci[2], ci[3])) / 2;

      expect(Math.abs(w - spec.scaleMm)).toBeLessThan(1.5);
      expect(Math.abs(h - spec.scaleMm)).toBeLessThan(1.5);
      expect(Math.abs(dia - spec.scaleMm / 2)).toBeLessThan(1.5);
    });
  }
});
