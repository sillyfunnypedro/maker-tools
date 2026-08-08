# Requirements: Extract App.tsx into Custom Hooks

## Context
`src/App.tsx` is ~1400 lines handling worker lifecycle, two image pipelines,
view transforms, a line editor, export logic, and debug dump — all in one file.

## Requirements

WHEN a developer needs to modify the frame detection pipeline
THE SYSTEM SHALL have that logic isolated in `src/hooks/useFramePipeline.ts`
SO THAT changes don't risk breaking unrelated glass-mode or export code.

WHEN a developer needs to modify the view transform (rotate/zoom/pan)
THE SYSTEM SHALL have that logic isolated in `src/hooks/useViewTransform.ts`
SO THAT the drag/zoom math is testable and readable independently.

WHEN a developer needs to modify the line editor (stroke selection/exclusion)
THE SYSTEM SHALL have that logic isolated in `src/hooks/useLineEditor.ts`
SO THAT interactive editing state is separated from pipeline processing.

WHEN a developer needs to modify export (SVG/PNG/share)
THE SYSTEM SHALL have that logic isolated in `src/hooks/useExport.ts`
SO THAT export formats can be added without touching pipeline code.

WHEN the refactoring is complete
THE SYSTEM SHALL pass all 155+ existing vitest tests unchanged
AND the app SHALL behave identically in both frame and glass modes.

WHEN any hook is extracted
THE SYSTEM SHALL NOT import from other extracted hooks directly
SO THAT hooks communicate only through the composing component (App.tsx).
