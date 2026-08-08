# Design: Cleanup Scripts & Pipeline Unification

## Part A: Script Cleanup

### Delete
- `qr-preview/debug-profile.ts`
- `qr-preview/debug-relief.ts`
- `qr-preview/debug-relief2.ts`
- `qr-preview/dump-points.ts`
- `qr-preview/dump-svg.ts`
- `qr-preview/test-contour.ts`
- `qr-preview/test-insert.ts`
- `qr-preview/test-insert-3.ts`
- `qr-preview/test-relief-styles.ts`

### Keep
- `qr-preview/emit-print.ts` — frame PDF generation
- `qr-preview/run-areas.ts` — offline areas pipeline
- `qr-preview/run-fingers.ts` — offline finger joint pipeline

### Add
- `qr-preview/README.md` — documents the three pipelines

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
