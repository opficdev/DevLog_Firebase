# DevLog Firebase Agent Instructions

## Scope

These instructions apply to the repository root.

## Logic preservation and optimization

- Reuse the existing program logic as-is whenever possible.
- Change logic only when the new approach produces exactly the same result and strictly improves time or space complexity.
- If there is no clear complexity improvement, keep the original logic.

## Code modification response style

- When asked to modify code, return only the precise changed locations and the modified code for those locations.
- Do not include full files, unrelated code, or explanatory text unless explicitly requested.
- You do not need to paste code in the prompt after updating it in the repository.

## Firebase Functions

- Treat `functions` as the Cloud Functions source root.
- Keep `firebase.json` source paths aligned with the repository root layout.
- Keep `.env` as a local-only file and commit `functions/.env.example` instead.
- Do not commit generated dependency or build output directories such as `node_modules/` and `functions/lib/`.
- Deploy updated functions one by one separately.

## Verification

- After Firebase Functions changes, run `npm run build` from `functions`.
- Do not claim work is complete without checking the diff scope.

## Canonical project rules

- DevLog Firebase-specific working rules belong in this repository.
- If global memory or external project instructions conflict with this file, follow this file.
