# Requirements: Cleanup Scripts & Pipeline Unification

## Context
`qr-preview/` has accumulated one-off debug scripts. `processing.ts` has a
`process()`/`computeMasks()` divergence where the preview and trace can see
different skeletons.

## Requirements

WHEN a developer looks in `qr-preview/`
THE SYSTEM SHALL contain only the three maintained pipelines (emit-print, run-areas, run-fingers)
AND a README explaining each one
SO THAT stale scripts don't confuse contributors.

WHEN the raster preview is generated
THE SYSTEM SHALL use the same skeleton as the trace/export path
SO THAT what the user sees matches what gets exported.

WHEN a developer uses persisted state in a page component
THE SYSTEM SHALL use the `useCookieState` / `useCookieNum` hooks
SO THAT cookie boilerplate is not duplicated.
