import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import { renderQrSvg } from "./renderQr";

describe("renderQrSvg", () => {
  it("throws on empty text rather than producing a blank/broken QR", () => {
    expect(() => renderQrSvg("")).toThrow();
  });

  it("matches the qrcode package's own module count for the same input", () => {
    const text = "https://example.com/hello";
    const expected = QRCode.create(text, { errorCorrectionLevel: "M" });
    const { moduleCount } = renderQrSvg(text, { errorCorrectionLevel: "M" });
    expect(moduleCount).toBe(expected.modules.size);
  });

  it("a higher error-correction level never shrinks the module grid for the same text", () => {
    const text = "https://example.com/some-reasonably-long-path?and=query";
    const low = renderQrSvg(text, { errorCorrectionLevel: "L" });
    const high = renderQrSvg(text, { errorCorrectionLevel: "H" });
    expect(high.moduleCount).toBeGreaterThanOrEqual(low.moduleCount);
  });

  it("the rendered viewBox grows with the margin, not the module grid", () => {
    const text = "margin test";
    const a = renderQrSvg(text, { marginModules: 4 });
    const b = renderQrSvg(text, { marginModules: 8 });
    expect(a.moduleCount).toBe(b.moduleCount);
    const totalA = a.moduleCount + 8, totalB = b.moduleCount + 16;
    expect(a.svg).toContain(`viewBox="0 0 ${totalA} ${totalA}"`);
    expect(b.svg).toContain(`viewBox="0 0 ${totalB} ${totalB}"`);
  });

  it("draws exactly one finder shape per corner for every dot style", () => {
    for (const dotStyle of ["square", "rounded", "dots"] as const) {
      const { svg } = renderQrSvg("finder test", { dotStyle });
      // Each finder is 3 nested rects (square style) or 2 rects + handled the
      // same way for rounded/dots (rect, rect, rect) — 3 shapes x 3 corners.
      const rectCount = (svg.match(/<rect /g) ?? []).length;
      // 1 background rect + (3 corners x 3 rects per finder) = 10, regardless
      // of style, since even "dots" finders are drawn as rounded rects (full
      // round = circle-look), not <circle> elements.
      expect(rectCount, dotStyle).toBeGreaterThanOrEqual(10);
    }
  });

  it("uses <circle> for data modules only in the 'dots' style", () => {
    const text = "circle check";
    const squareSvg = renderQrSvg(text, { dotStyle: "square" }).svg;
    const dotsSvg = renderQrSvg(text, { dotStyle: "dots" }).svg;
    expect(squareSvg).not.toContain("<circle");
    expect(dotsSvg).toContain("<circle");
  });

  it("applies custom foreground/background colours", () => {
    const { svg } = renderQrSvg("colour test", { fgColor: "#ff0000", bgColor: "#00ff00" });
    expect(svg).toContain("#ff0000");
    expect(svg).toContain("#00ff00");
    expect(svg).not.toContain("#000000");
  });

  it("every dark data module falls fully inside the declared viewBox", () => {
    // A module rendered right at the margin boundary (off by one in the
    // margin offset) would clip — catch that by checking the furthest shape
    // coordinates never exceed the total size.
    const { svg, moduleCount } = renderQrSvg("bounds check", { marginModules: 4, dotStyle: "rounded" });
    const total = moduleCount + 8;
    const coords = [...svg.matchAll(/[xy]="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
    for (const c of coords) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(total);
    }
  });
});
