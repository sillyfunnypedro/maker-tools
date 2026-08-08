# Tasks: Cleanup Scripts & Pipeline Unification

- [ ] Add `qr-preview/README.md` documenting maintained pipelines vs one-off debug scripts
- [ ] Fix any one-off scripts that reference old APIs (update imports/signatures)
- [ ] Unify `process()` and `computeMasks()` into single `pipeline()` function
- [ ] Update worker to use `pipeline()` for both raster preview and trace
- [ ] Refactor FingerJointPage.tsx to use `useCookieState` / `useCookieNum` hooks
- [ ] Verify: `npm test` passes
- [ ] Verify: `npm run build` passes
- [ ] Verify: all three offline pipelines still work (`emit:print`, `areas`, `fingers`)
