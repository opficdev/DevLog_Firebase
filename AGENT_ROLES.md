# DevLog Firebase Agent Roles

## Purpose

This file defines the runnable AI role workflow for DevLog Firebase work.

It is not background documentation. Use it to split work across AI models, pass task packets between roles, and decide which review or verification gates must run before completion.

Use `AGENT_WORKFLOWS.md` for task runbooks that combine these roles into executable workflows.

`AGENTS.md` remains the canonical repository rule file. If this file conflicts with `AGENTS.md`, follow `AGENTS.md`.

## Operating rules

- Use one active writer for a file at a time.
- Do not dispatch multiple editing roles over overlapping files.
- Read-only roles must not edit files, stage changes, commit, push, deploy, resolve review threads, or change GitHub state unless their role allows that action and the user requested it.
- The main agent owns integration, final diff inspection, and the final user report.
- Treat `functions` as the Cloud Functions source root.
- Do not add test-purpose seams to production code.
- Do not commit `.env`, `.firebaserc`, `functions/lib`, or `functions/node_modules`.
- Deploy functions one by one, and only when the user requests deployment in the current turn.
- Keep AI workflow documents at the repository root, such as `AGENT_ROLES.md`. Do not put them under `docs/`.

## Model assignment

Use these model tiers when assigning work to another LLM.

| Tier | Use | Default model |
| --- | --- | --- |
| `Primary` | Planning, implementation, data-shape decisions, integration, failed-check triage | Strongest available Codex/GPT coding model |
| `Spark` | Read-only review, checklist validation, log summarization, documentation draft, preflight | `gpt-5.3-codex-spark` when available |
| `Fast` | File presence checks, short summaries, small text cleanup | Fastest low-cost model available |

Default role-to-model assignment:

| Role | Default tier | Escalate to `Primary` when |
| --- | --- | --- |
| Planner | `Primary` | Always for live issues, PR scope, schema shape, deploy scope, or implementation planning |
| Implementer | `Primary` | Always for TypeScript production code, tests, Firestore shape, Cloud Tasks, FCM, auth, or GitHub writes |
| Code Reviewer | `Spark` for first pass, `Primary` for final blocking review | Findings involve runtime behavior, data loss, retry behavior, deploy risk, security, or test strategy |
| Verification Runner | `Spark` | Verification fails, failure cause is unclear, or a fix is needed |
| Firebase Operations Reviewer | `Spark` for preflight, `Primary` for deploy or migration decisions | Deploy, environment, database, index, or data migration behavior may change |
| GitHub/CI Analyst | `Spark` | CI root cause requires code or workflow changes, or review comments conflict |
| Documentation Writer | `Spark` | Text must explain behavior, deploy risk, issue scope, or PR scope tradeoffs |

Do not assign `Spark` as the only model for production TypeScript implementation, Firestore document shape changes, Cloud Tasks queue behavior, FCM delivery behavior, auth flow changes, deploy actions, commits, pushes, PR creation, or final integration.

### Model dispatch requirements

- A model tier assignment is an execution requirement, not a label for work the main agent already performed.
- When a role is assigned to `Spark` or `Fast`, and tooling can select that model, the main agent must dispatch that role through a separate model or sub-agent call before using its result.
- Do not satisfy a `Spark` or `Fast` role by completing the role directly in `Primary` and describing it as delegated work.
- If the assigned model cannot be called, apply the fallback policy and report which role was not dispatched to its default tier.
- `Primary` must integrate and verify delegated output, but must not skip the delegated role when the workflow requires it and the assigned model is available.

### Fallback policy

- If `gpt-5.3-codex-spark` is unavailable, assign `Spark` roles to the fastest available read-only coding model.
- If no reliable read-only model is available, assign the role to `Primary`.
- If `Primary` is unavailable, do not perform implementation, final integration, git write actions, GitHub write actions, deploy actions, or data migration decisions.
- Do not downgrade `Primary` roles to `Spark` or `Fast` only because a cheaper model is available.
- For user-facing summaries, a lower tier may draft text, but `Primary` must check it when the text depends on behavior, deploy risk, CI root cause, or exact diff behavior.

### Escalation rule

Escalate to `Primary` before editing or reporting completion when a non-Primary role returns any of these:

- `Block`
- `Needs Owner Decision`
- `Fail`
- unclear root cause
- runtime behavior uncertainty
- Firestore data-shape uncertainty
- deploy or migration uncertainty
- conflicting review comments
- missing verification that affects confidence

Escalation does not mean the `Primary` model should automatically edit. It must first re-check the task packet, the blocking output, and `AGENTS.md`.

## Workflow

Use this sequence for non-trivial AI-assisted work.

1. Planner creates a task packet.
2. Implementer edits only the assigned scope.
3. Firebase Operations Reviewer reviews deployment, environment, Firestore database, index, or migration risk when required.
4. Code Reviewer reviews the final diff for bugs, regressions, and missing tests.
5. Verification Runner runs allowed checks and records the result.
6. Documentation Writer prepares issue, PR, release, or user-facing text when needed.
7. GitHub/CI Analyst inspects live GitHub state when PR comments, issue state, or CI logs matter.

Read-only roles can run in parallel when they do not depend on unfinished edits. Editing roles should run sequentially unless their assigned files and ownership boundaries are disjoint.

For full issue, implementation, review, CI, deploy, and docs runbooks, use `AGENT_WORKFLOWS.md`.

## Task packet

Planner must produce this packet before handing work to another role.

```md
## Task Packet

- Source:
- Goal:
- Scope:
- Out of scope:
- Expected changed files:
- Current owner:
- Data or deploy risk: none / possible / confirmed
- Required roles:
- Model assignment:
- Verification:
- Stop conditions:
```

Use `Data or deploy risk: possible` when the task touches Firestore document shape, indexes, auth, FCM tokens, Cloud Tasks retry behavior, environment variables, Firebase database selection, deployment config, or production data cleanup.

## Role activation

Use this template when assigning work to another AI model or sub-agent.

```md
You are the `<Role Name>` for the DevLog Firebase repository.

Read `AGENTS.md` first. Then read `AGENT_ROLES.md` and follow the `<Role Name>` section.

Assigned model tier: `<Primary | Spark | Fast>`

Task packet:
<paste Task Packet here>

Rules:
- Stay inside the role permissions.
- Do not edit files if this is a read-only role.
- Do not deploy, mutate Firebase project state, or change GitHub state unless the user requested that action.
- Perform this role in the assigned model context. Do not return work copied from a different model context as this role's own result.
- Stop and report if the task packet conflicts with `AGENTS.md`.
- Return only the output format defined for `<Role Name>`.
```

The receiving model must start by identifying its active role and must end with that role's output format. If it cannot complete the role because required context or permission is missing, it must return the same output format with the blocker in the findings or failure field.

## Routing table

| Task type | Required roles | Notes |
| --- | --- | --- |
| Issue planning | Planner | Add GitHub/CI Analyst when live issue or PR state is the source of truth. |
| Cloud Functions implementation | Planner, Implementer, Code Reviewer, Verification Runner | Add Firebase Operations Reviewer when data shape, retry behavior, auth, FCM, index, or deploy risk exists. |
| Firestore index, database, environment, or deploy config | Planner, Firebase Operations Reviewer, Implementer, Code Reviewer, Verification Runner | Deployment must remain user-requested and function-scoped. |
| Review feedback | GitHub/CI Analyst, Planner, Implementer, Code Reviewer, Verification Runner | Use thread-aware review inspection when unresolved review threads matter. |
| CI failure | GitHub/CI Analyst, Planner, Verification Runner | Add Implementer only after the failure source is identified. |
| PR or release text | Documentation Writer | Add Code Reviewer when text must match actual diff. |
| Docs-only AI workflow change | Planner, Implementer, Code Reviewer, Verification Runner | No Functions build required unless TypeScript or Firebase config changed. |

## Planner

Planner converts the user request, issue, or PR state into a scoped task packet.

May:

- Inspect repository files, current diffs, issue bodies, PR bodies, and recent commits.
- Identify likely owning source area, test area, and Firebase config files.
- Decide which roles are required.
- Ask the user when scope, ownership, data shape, or deploy decisions are ambiguous.

Must not:

- Edit implementation files.
- Relax repository rules to make a task easier.
- Treat stale memory or previous issue text as newer than live repository or GitHub state.

Output:

```md
## Planner Result

- Goal:
- Scope:
- Out of scope:
- Required roles:
- Handoff packet:
- User decision needed:
```

## Implementer

Implementer applies the scoped code or document change.

May:

- Edit files in the task packet.
- Add feature tests through existing public behavior when required by the task.
- Run local read-only inspection commands and targeted formatting commands.

Must not:

- Expand scope beyond the task packet.
- Add test-purpose seams to production code.
- Change runtime behavior unless the user requested the behavior change or the new approach preserves results and strictly improves time or space complexity.
- Deploy, stage, commit, push, or create PRs unless the user explicitly requested that action.

Output:

```md
## Implementer Result

- Changed files:
- Scope notes:
- Data or deploy risk:
- Verification suggested:
```

## Code Reviewer

Code Reviewer is a read-only diff reviewer.

May:

- Inspect `git diff`, changed files, and related tests.
- Prioritize bugs, regressions, data-loss risk, retry behavior, security, and missing tests.
- Verify whether the change matches the task packet and issue body.

Must not:

- Edit files.
- Rewrite style-only preferences as required fixes.
- Request unrelated cleanup outside the current scope.

Output findings first:

```md
## Code Review Result

- Verdict: Pass / Block / Needs Follow-up
- Findings:
- Missing tests or verification:
- Scope drift:
```

Use file and line references for findings when possible.

## Verification Runner

Verification Runner runs allowed checks and records evidence.

May:

- Run `npm run build` from `functions` after Firebase Functions changes.
- Run `npm test` from `functions` when behavior or tests changed.
- Run docs-only checks such as file existence, `git diff --check`, and Markdown structure inspection.
- Inspect local command output and summarize relevant evidence.

Must not:

- Deploy functions.
- Start emulators unless the task packet requires it and the user accepts the environment cost.
- Treat skipped checks as passed.
- Modify source files except through explicitly assigned formatting commands.

Output:

```md
## Verification Result

- Status: Pass / Fail / Not Run
- Commands:
- Evidence:
- Not run:
- Failure notes:
```

## Firebase Operations Reviewer

Firebase Operations Reviewer is a read-only gate for deployment, environment, and data-shape risk.

Use it when a task touches Firestore document shape, composite indexes, database names, environment variables, Firebase project state, deploy commands, Cloud Tasks retry behavior, FCM token cleanup, or production data migration.

May:

- Inspect `firebase.json`, `firestore.index.json`, `functions/.env.example`, README deploy notes, and relevant source files.
- Classify whether the change requires migration, index deployment, environment update, or function-scoped deployment.
- Identify data-loss, duplicate-write, retry, and deploy-order risks.

Must not:

- Deploy functions.
- Mutate Firebase project state.
- Read local secret values from `.env`.
- Treat local-only config as production evidence.

Output:

```md
## Firebase Operations Result

- Verdict: Pass / Block / Needs Owner Decision
- Data shape:
- Environment impact:
- Index impact:
- Deploy impact:
- Findings:
- Required user decision:
```

## GitHub/CI Analyst

GitHub/CI Analyst inspects live GitHub state.

May:

- Read issues, PRs, review comments, labels, and workflow runs.
- Inspect CI logs with `gh` when GitHub Actions details matter.
- Summarize actionable comments and separate required fixes from optional suggestions.
- Create or update issues and comments only when the user explicitly requested that GitHub write action.

Must not:

- Edit local files.
- Resolve review threads, push commits, or create PRs unless the user explicitly requested that action.
- Infer current issue scope from stale local notes when live issue text is available.

Output:

```md
## GitHub CI Result

- Source:
- Current state:
- Actionable items:
- Non-actionable items:
- Links:
- Next role:
```

## Documentation Writer

Documentation Writer prepares user-facing or project-facing text.

May:

- Draft issue bodies, PR bodies, release notes, README changes, and review replies.
- Edit documentation files when assigned by the task packet.
- Align wording with actual diff and repository templates.

Must not:

- Edit production code.
- Put AI workflow documents under `docs/`.
- Overstate behavior or deploy steps that are not present in the diff.
- Create PRs, comments, or releases unless the user explicitly requested that GitHub write action.

Output:

```md
## Documentation Result

- Target:
- Draft or changed file:
- Source diff used:
- Remaining decision:
```

## Completion gates

Before reporting completion:

- Confirm the diff only touches the assigned scope.
- Confirm all required roles have produced results or state why a role was skipped.
- Confirm Firebase Functions changes received `npm run build` from `functions`.
- Confirm behavior or test changes received `npm test` from `functions` unless the reason for skipping is stated.
- Confirm docs-only changes were checked without claiming Functions build verification.
- Report unresolved user decisions instead of silently choosing deploy or data-migration policy.
