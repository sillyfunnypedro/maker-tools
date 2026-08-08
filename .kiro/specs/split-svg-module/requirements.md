# Requirements: Split svg.ts into Focused Modules

## Context
`src/svg.ts` is ~876 lines conflating skeleton tracing, polyline stitching,
RDP simplification, Bezier smoothing, polygon clipping, and SVG serialization.

## Requirements

WHEN a developer needs to modify the skeleton pixel-tracing algorithm
THE SYSTEM SHALL have that logic isolated in `src/svg/trace.ts`
SO THAT changes to tracing don't risk breaking simplification or clipping.

WHEN a developer needs to modify RDP simplification or Catmull-Rom smoothing
THE SYSTEM SHALL have that logic isolated in `src/svg/simplify.ts`
SO THAT curve math is testable independently.

WHEN a developer needs to modify the SVG export format
THE SYSTEM SHALL have that logic isolated in `src/svg/export.ts`
SO THAT output formatting is separate from geometry computation.

WHEN the refactoring is complete
THE SYSTEM SHALL pass all existing `svg.test.ts` tests unchanged
AND imports from `src/svg.ts` SHALL continue to work via re-exports.

WHEN a new module is added to `src/svg/`
THE SYSTEM SHALL re-export its public API from `src/svg/index.ts`
SO THAT existing consumers don't need import path changes.
