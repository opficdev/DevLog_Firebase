# DevLog Firebase Agent Instructions

## Scope

These instructions apply to the repository root.

## Logic preservation and optimization

- Reuse the existing program logic as-is whenever possible.
- Change logic only when the new approach produces exactly the same result and strictly improves time or space complexity.
- If there is no clear complexity improvement, keep the original logic.

## Production code and test boundaries

- Do not add test-purpose code or test-convenience structure to production code.
- Do not expose internal functions, add dependency injection points, branch runtime behavior, or introduce test-only helpers unless the same change is required by production behavior.
- If verification needs a seam, prefer testing through existing public behavior or reducing the test scope instead of changing production structure for test convenience.
- For behavior changes, write feature tests that describe the new expected user-facing or public behavior instead of framing them as regression tests.
- Do not label or plan tests as regression tests when the work should be expressed as feature behavior; convert that scope into feature-test wording and coverage.
- When a production refactor is independently justified, keep the commit scope and message centered on the production reason.

## Code modification response style

- When asked to modify code, return only the precise changed locations and the modified code for those locations.
- Do not include full files, unrelated code, or explanatory text unless explicitly requested.
- You do not need to paste code in the prompt after updating it in the repository.

## AI role workflow

- For non-trivial AI-assisted work, read `AGENT_ROLES.md` before planning, implementing, reviewing, or verifying the task.
- Use `AGENT_ROLES.md` to assign model-specific roles, define handoff packets, and run review or verification gates.
- Use `AGENT_WORKFLOWS.md` when a task should be executed through repeatable role-based workflows.
- Treat `AGENT_ROLES.md` as an operational extension of this file. If it conflicts with `AGENTS.md`, follow `AGENTS.md`.
- Keep AI workflow documents at the repository root. Do not add AI workflow documents under `docs/`.

## TypeScript documentation and formatting

- Add a one-sentence comment explaining the role of each declared type and method.
- For properties inside a type, add a short comment describing what data the property stores.
- Write all newly added comments in Korean.
- Do not write implementation names such as type, function, method, variable, or property names as the subject of comments.
- Apply these rules only to code that is directly related to the current change.
- When a named import has three or more imported members, put each member on its own line:
```ts
import {
    FirstMember,
    SecondMember,
    ThirdMember
} from "./module";
```

- For function or method declarations with two or more parameters, put each parameter on its own line:
```ts
function someFunction(
    firstParameter: string,
    secondParameter: number
) {
    // ...
}
```

- For long conditional expressions, put the opening parenthesis on its own line and split each logical condition by `&&` or `||`:
```ts
if (
    firstCondition ||
    secondCondition ||
    thirdCondition
) {
    // ...
}
```

- For function or method call sites, prefer the existing local style and framework conventions.
- When destructuring or returning many fields, group fields by role on adjacent lines and keep the same order between the returned object and the destructuring site:
```ts
const {
    db, dispatchDocRef, notificationDocRef,
    userId, todoId, dueDateKey,
    title, body, todoCategory, notificationData
} = prepared;
```

- Do not compress unrelated destructuring fields or positional arguments into one line only to reduce vertical length.
- For function or method call sites with several positional arguments, put each argument on its own line unless the local code already uses a clearly readable compact convention:
```ts
await saveNotification(
    notificationDocRef,
    notificationData,
    req.data,
    userId,
    todoId,
    dueDateKey
);
```

## Firebase Functions

- Treat `functions` as the Cloud Functions source root.
- Keep `firebase.json` source paths aligned with the repository root layout.
- Keep `.env` as a local-only file and commit `functions/.env.example` instead.
- Do not commit generated dependency or build output directories such as `node_modules/` and `functions/lib/`.
- Deploy updated functions one by one separately.

## Git and commit rules

- Commit messages must start with a short prefix used by recent local commits, such as `feat`, `fix`, `refactor`, `chore`, `test`, `docs`, `ui`, or `rollback`.
- Write commit message prose in Korean.
- Keep implementation names such as `requestGithubTokensWithCode`, `GitHubOAuthResponse`, `functions/src/rest/githubAuth.ts`, commands, branch names, and commit hashes in their original form.
- Do not translate implementation names into Korean unless the user explicitly asks for a user-facing Korean label.
- Do not write a commit message body.
- If the user explicitly specifies a prefix or noun-phrase ending, follow it exactly.
- When checking recent commit-message style, do not infer local commit style from GitHub merge or squash-merge subjects such as `[#5] ... (#6)`.
- For squash-merge commits, inspect the commit body and use the individual commit messages as the style reference.

## Pull Requests

- Before drafting or creating a pull request, read `.github/pull_request_template.md` and follow that template exactly.
- Do not invent pull request sections when a repository template exists.

## Verification

- After Firebase Functions changes, run `npm run build` from `functions`.
- Do not claim work is complete without checking the diff scope.

## Canonical project rules

- DevLog Firebase-specific working rules belong in this repository.
- If global memory or external project instructions conflict with this file, follow this file.
