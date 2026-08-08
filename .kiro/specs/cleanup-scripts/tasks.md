# Tasks: Cleanup Scripts & Pipeline Unification

- [ ] Delete all one-off scripts from qr-preview/ (9 files)
- [ ] Add `qr-preview/README.md` documenting the three pipelines
- [ ] Unify `process()` and `computeMasks()` into single `pipeline()` function
- [ ] Update worker to use `pipeline()` for both raster preview and trace
- [ ] Refactor FingerJointPage.tsx to use `useCookieState` / `useCookieNum` hooks
- [ ] Verify: `npm test` passes
- [ ] Verify: `npm run build` passes
- [ ] Verify: all three offline pipelines still work
