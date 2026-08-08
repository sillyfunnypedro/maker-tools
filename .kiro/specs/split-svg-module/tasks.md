# Tasks: Split svg.ts into Focused Modules

- [ ] Create `src/svg/types.ts` with Pt, Mat3, StrokeGroup
- [ ] Create `src/svg/trace.ts` with traceSkeleton and helpers
- [ ] Create `src/svg/stitch.ts` with mergePolylines, chainStrokes, stitchRuns
- [ ] Create `src/svg/simplify.ts` with rdp, rdpClosed, corner detection, Catmull-Rom
- [ ] Create `src/svg/clip.ts` with Sutherland-Hodgman and view transforms
- [ ] Create `src/svg/export.ts` with renderStrokeGroups, strokesToSvg, buildCncStrokedSvg
- [ ] Create `src/svg/areas.ts` with traceAreaGroups
- [ ] Create `src/svg/index.ts` re-exporting all public APIs
- [ ] Delete `src/svg.ts`
- [ ] Update `src/svg.test.ts` import path
- [ ] Verify: `npm test` passes (155+ tests)
- [ ] Verify: `npm run build` passes
