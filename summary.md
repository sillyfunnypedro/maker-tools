# QR payload size investigation

Question: can the printed QR codes on the SketchFrame sheets be made smaller by
putting less data in them, while still driving the frame's sizing from the QR?

## Current state

`src/qrframe/spec.ts` encodes the frame as a semicolon-delimited, magic-prefixed
string with **14 fields**:

```
SGF1;<id>;<innerW>;<innerH>;<scaleMm>;<marginL>;<marginT>;<marginR>;<marginB>;<qrX>;<qrY>;<qrSize>;<dotSpacing>;<dotD>
```

Generated in `src/qrframe/generate.ts:19-20` via `QRCode.create(encodePayload(spec), { errorCorrectionLevel: "M" })`
(library: `qrcode`). Decoded in `src/qrframe/detect.ts:89-93` via `jsQR` → `decodePayload`.
The decoded spec then drives everything downstream: opening size, registration-dot
positions (`dotLayoutMm`), and the QR's own corner positions for the homography fit.

The design intent, stated directly in `spec.ts:1-5`, is that the payload is
**fully self-describing** — "the app needs no shared registry and new frame sizes
need no app update." That's why every geometry field is in the QR rather than
looked up from `STANDARD_SPECS` by id alone.

### Measured sizes today (EC level M)

| id | payload | length | QR version | modules | mm/module (at current `qrSize`) |
|---|---|---|---|---|---|
| std | `SGF1;std;150;168;90;34;34;12;12;4;4;27;14;4` | 43 | **4** | 33×33 | 0.818 |
| half | `SGF1;half;75;84;45;26;26;9;9;3;3;20;11;3` | 40 | **3** | 29×29 | 0.690 |
| square100 | `SGF1;square100;100;100;60;28;28;10;10;3;3;22;12;3.5` | 51 | **4** | 33×33 | 0.667 |
| large | `SGF1;large;216;279;150;38;38;14;14;5;5;30;16;5` | 46 | **4** | 33×33 | 0.909 |
| bigsquare | `SGF1;bigsquare;246;246;150;38;38;14;14;5;5;30;16;5` | 50 | **4** | 33×33 | 0.909 |

Version 4 needs 33×33 modules regardless of `qrSize` — the physical mm size is
fixed per spec, so all those modules just get smaller and harder for a phone
camera to resolve. Shrinking the payload buys back either a smaller printed QR
at the same module size, or a bigger, more reliable module size at the same
printed QR footprint.

## Options tried (measured, not just estimated)

**A — id only, look up everything else** (`SGF1;std`, etc.)
Drops straight to **version 1 (21×21 modules)** for every size. Biggest win by
far, but it directly reverses the stated design goal: the app would need a
built-in registry keyed by id, and a custom/future frame size would need an app
update to be recognized. Not "less info," it's a different architecture.

**B — id + window size + scale, look up the rest** (`SGF1;std;150;168;90`)
Drops to **version 2 (25×25 modules)** for every current size — 25² / 33² ≈ 57%
of the module count, a real reduction. This matches what was actually asked
for: the QR still carries the opening's own dimensions (`innerW`/`innerH`) and
scale, so the frame's *size* still comes from the QR rather than being purely
assumed from id. What gets dropped from the payload — margins, QR position/size,
dot spacing/diameter — are visual-layout constants that, per `STANDARD_SPECS`
(`generate.ts:11-17`), are already fixed per id and never vary independently of
it today. Recovering them at decode time means looking them up by id, which is
a smaller, narrower version of the same registry dependency as option A, scoped
only to layout constants rather than the frame's actual size.

**C — keep all 14 fields, just lower error correction (M → L)**
Only helps the versions that are already borderline (`std`/`large`/`bigsquare`/`square100`
drop from version 4 → 3; `half` stays at 3). Much smaller win than B, and trades
away damage/glare tolerance on a sheet that's photographed under real-world
lighting — not recommended on its own.

**D — B, plus terser id codes and a shorter magic string** (`S1;0;150;168;90`)
Roughly the same version as B in most cases (one case drops an extra step).
Diminishing returns for the loss of a human-readable payload (harder to debug
a misread or corrupted scan by eye).

## Recommendation

Option **B** is the best match for the actual request: keep `innerW`/`innerH`/
`scaleMm` in the QR (so the frame's size still visibly comes from the code, and
a "custom" size could still be represented later), but derive the margin/QR/dot
layout constants from `id` instead of encoding them — since they don't vary
independently of `id` today anyway. That's close to a 40% cut in module count
for every current frame size, without giving up the actual size-sourcing
guarantee.

The trade-off worth confirming before implementing: this does mean a lookup
table for the layout constants (probably just `STANDARD_SPECS` itself, keyed by
`id`) becomes load-bearing at decode time, which is a partial rollback of the
"no shared registry, no app update needed" property called out in `spec.ts:1-5`.
If a truly registry-free/self-describing payload has to be preserved in full,
the alternative is deriving margins/`qrSize`/dot spacing from `innerW`/`innerH`
by formula — but the current `STANDARD_SPECS` values aren't a clean function of
opening size (e.g. margins don't scale linearly, `scaleMm` isn't a fixed ratio
for the non-square `large` frame), so that would mean re-tuning those constants
rather than just changing the payload.

## Places that would need to change for option B

- `src/qrframe/spec.ts:30-45` — `encodePayload`/`decodePayload`: shrink to
  4 fields; `decodePayload` needs to look up the rest from `STANDARD_SPECS` by id
  (currently that table lives in `generate.ts`, so it may need to move to
  `spec.ts` or be passed in to avoid a circular import).
- `src/qrframe/generate.ts:11-17` — `STANDARD_SPECS` becomes the decode-time
  registry as well as the print-time source, so it needs to be importable from
  wherever `decodePayload` lives.
- `src/qrframe/detect.ts` and `detect.test.ts:21` — both currently assume the
  full spec round-trips through the QR payload alone; detect.test.ts also
  duplicates the `errorCorrectionLevel: "M"` option and would need updating if
  the payload shape changes.
- `README.md:67-69` — describes the QR as carrying "the frame's own dimensions"
  as the shared source of truth; still true under option B (size fields stay),
  but worth a line noting layout constants are looked up by id.
