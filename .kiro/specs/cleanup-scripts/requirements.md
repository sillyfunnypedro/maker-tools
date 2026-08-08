# Requirements: Cleanup Scripts & Pipeline Unification

## Context
`qr-preview/` has accumulated one-off debug scripts. `processing.ts` has a
`process()`/`computeMasks()` divergence where the preview and trace can see
different skeletons.

## Requirements

WHEN a developer looks in `qr-preview/`
THE SYSTEM SHALL contain a README explaining which scripts are maintained pipelines
and which are one-off debug tools
SO THAT contributors know what's current and what's ad-hoc.

WHEN a developer runs any script in `qr-preview/`
THE SYSTEM SHALL have that script work against the current API
SO THAT stale imports don't produce confusing errors.

WHEN the raster preview is generated
THE SYSTEM SHALL use the same skeleton as the trace/export path
SO THAT what the user sees matches what gets exported.

WHEN a developer uses persisted state in a page component
THE SYSTEM SHALL use the `useCookieState` / `useCookieNum` hooks
SO THAT cookie boilerplate is not duplicated.
