# Design: Extract App.tsx into Custom Hooks

## Architecture

App.tsx becomes a thin shell (~300 lines) that:
1. Calls each hook to get state and callbacks
2. Passes state between hooks via their return values
3. Renders the JSX using that state

## Component Breakdown

| Hook | Inputs | Returns |
|---|---|---|
| `useWorker()` | — | `{ worker, postMessage }` |
| `useFramePipeline(worker, mode, detectMode)` | worker ref, mode state | `{ frameResult, frameSource, framePpmm, strokeGroups, ... }` |
| `useGlassPipeline(worker, mode)` | worker ref, mode state | `{ glassSource }` |
| `useViewTransform(frameResult)` | frame detection result | `{ rotate, zoom, pan, handlers }` |
| `useLineEditor(strokeGroups, frameResult, viewTransform)` | groups + view | `{ cncView, excluded, selected, click }` |
| `useExport(cncView, canvasRef, detectMode)` | view + canvas | `{ savePng, saveSvg, share, copy }` |

## Data Flow

```
useWorker
    ↓ worker
useFramePipeline ←→ useGlassPipeline
    ↓ frameResult, strokeGroups
useViewTransform
    ↓ rotate, zoom, pan
useLineEditor
    ↓ cncView, excluded
useExport
```

## Extraction Order

1. `useExport` (fewest dependencies, leaf node)
2. `useViewTransform` (self-contained state)
3. `useLineEditor` (depends on strokeGroups + view)
4. `useGlassPipeline` (simple, independent)
5. `useFramePipeline` (largest, most complex)
6. `useWorker` (extracted last since others depend on it implicitly)

## Error Handling
No change — errors remain in component state, shown via the existing `{error}` JSX.

## Testing Strategy
- Each hook can be tested with `renderHook` from `@testing-library/react-hooks` (optional, not required for this spec).
- Primary verification: existing 155+ tests pass, plus manual smoke test.
