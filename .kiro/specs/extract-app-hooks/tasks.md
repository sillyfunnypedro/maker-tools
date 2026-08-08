# Tasks: Extract App.tsx into Custom Hooks

- [ ] Extract `useExport` hook (download, share, savePng, saveCncSvg, copySvg)
- [ ] Extract `useViewTransform` hook (rotate, zoom, pan state + clamping + drag handlers)
- [ ] Extract `useLineEditor` hook (strokeGroups, cncView, selection, exclusion, clickStroke)
- [ ] Extract `useGlassPipeline` hook (glass-mode decode, flatten, Otsu, run preview)
- [ ] Extract `useFramePipeline` hook (frame detection, rectify, flatten, trace dispatch)
- [ ] Extract `useWorker` hook (worker lifecycle, message dispatch, response routing)
- [ ] Verify: `npm test` passes (155+ tests)
- [ ] Verify: manual smoke test in frame mode (detect, trace, rotate, zoom, export)
- [ ] Verify: manual smoke test in glass mode (load, threshold, save PNG)
- [ ] Verify: App.tsx is under 400 lines
