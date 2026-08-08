# Design: Cleanup Scripts & Pipeline Unification

## Part A: Script Documentation & Fixes

### Maintained pipelines
- `qr-preview/emit-print.ts` — frame PDF generation
- `qr-preview/run-areas.ts` — offline areas pipeline
- `qr-preview/run-fingers.ts` — offline finger joint pipeline

### One-off debug scripts (keep, fix if broken)
- `debug-profile.ts`, `debug-relief.ts`, `debug-relief2.ts` — relief debugging
- `dump-points.ts`, `dump-svg.ts` — geometry inspection
- `test-contour.ts` — contour tracer debugging
- `test-insert.ts`, `test-insert-3.ts` — insert mode debugging
- `test-relief-styles.ts` — relief style comparison

### Add
- `qr-preview/README.md` — explains which are maintained vs one-off, how to run each

## Part B: Pipeline Unification

Replace `process()` and `computeMasks()` with a single `pipeline()` function:

```ts
export function pipeline(data, w, h, params): {
  masks: Masks;           // skeleton, interior, lineCore
  display: Uint8ClampedArray;  // RGBA preview
}
```

The worker calls `pipeline()` once and uses both outputs.

## Part C: Apply Cookie Hook

Replace the 10 useState + 10 useEffect blocks in FingerJointPage.tsx with
calls to `useCookieState` and `useCookieNum` from `src/hooks/useCookieState.ts`.
