# Design: Split svg.ts into Focused Modules

## Module Structure

```
src/svg/
├── index.ts        — re-exports (backward compat)
├── types.ts        — Pt, Mat3, StrokeGroup
├── trace.ts        — traceSkeleton (pixel walking)
├── stitch.ts       — mergePolylines, chainStrokes, stitchRuns
├── simplify.ts     — rdp, rdpClosed, corner detection, Catmull-Rom
├── clip.ts         — Sutherland-Hodgman, view transform math
├── export.ts       — renderStrokeGroups, strokesToSvg, buildCncStrokedSvg
└── areas.ts        — traceAreaGroups
```

## Dependency Graph

```
types.ts (no deps)
    ↑
trace.ts (uses types)
    ↑
stitch.ts (uses types, trace output)
    ↑
simplify.ts (uses types)
    ↑
clip.ts (uses types, simplify)
    ↑
export.ts (uses all above)
    ↑
areas.ts (uses types only)
```

## Migration Strategy
- `src/svg.ts` deleted, replaced by `src/svg/index.ts` re-exporting everything.
- `src/svg.test.ts` import path updated to `./svg` (resolves to index.ts).
- Worker and App imports unchanged (they already import from `./svg`).

## Testing Strategy
Existing `svg.test.ts` continues to work with only import path adjustment.
No new tests required for this spec (pure file reorganization).
