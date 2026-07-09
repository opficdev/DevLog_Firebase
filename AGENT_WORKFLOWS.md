# DevLog Firebase Agent Workflows

## Purpose

This file defines executable AI workflows for DevLog Firebase work.

Use this after reading `AGENTS.md` and `AGENT_ROLES.md`. `AGENT_ROLES.md` defines what each role may do. This file defines how to combine those roles for common repository tasks.

If this file conflicts with `AGENTS.md`, follow `AGENTS.md`.

## Main-agent protocol

The main agent must run every workflow with this protocol.

1. Read `AGENTS.md`, then `AGENT_ROLES.md`, then this file.
2. Select one workflow from this file.
3. Create the task packet.
4. Assign only the roles required by the selected workflow.
5. Assign each role a model tier from `AGENT_ROLES.md`.
6. Dispatch each `Spark` or `Fast` role through a separate model or sub-agent call when tooling can select that assigned model.
7. Dispatch read-only `Spark` or `Fast` roles in parallel only when they do not depend on unfinished edits.
8. Do not complete a required `Spark` or `Fast` role directly in `Primary` unless the fallback policy in `AGENT_ROLES.md` applies.
9. Keep `Primary` editing roles sequential unless the files and ownership boundaries are disjoint.
10. Integrate role outputs.
11. Escalate any `Spark` or `Fast` blocker to a `Primary` model before editing.
12. Run completion gates.
13. Report changed files, data or deploy decision, verification result, delegated roles, model tiers used, and unresolved decisions.

Do not skip the task packet. The task packet is the contract between models.

## Universal stop conditions

Stop and ask the user before editing when:

- The task packet conflicts with `AGENTS.md`.
- The requested fix requires a test-purpose seam in production code.
- The requested change may delete, rewrite, or migrate production data.
- A role needs to deploy functions or mutate Firebase project state.
- The current issue or PR scope is unclear after live GitHub inspection.
- Two editing roles would touch the same file.
- A read-only role reports `Block` or `Needs Owner Decision`.
- Verification fails for a reason that suggests a scope, data-shape, or deploy decision.

## Workflow selection

| User request | Workflow |
| --- | --- |
| "이슈 구현", issue number, feature, bug fix | Issue-driven implementation |
| Cloud Functions TypeScript change, Firestore read/write behavior, FCM, Cloud Tasks, auth | Firebase Functions implementation |
| Firestore index, database name, env var, firebase config, deploy command | Firebase operations change |
| PR review comment, unresolved thread, requested changes | Review-thread follow-up |
| Failing GitHub Actions, CI log, workflow failure | CI failure triage |
| PR body, release note, README, issue wording | Documentation-only writing |
| AI role, AGENTS, workflow, harness docs | AI workflow maintenance |

## Issue-driven implementation

Use when implementing a live issue or user-scoped code change.

### Role order

1. GitHub/CI Analyst, if live issue or PR state matters.
2. Planner.
3. Firebase Operations Reviewer, if `Data or deploy risk` is `possible` or `confirmed`.
4. Implementer.
5. Code Reviewer.
6. Verification Runner.
7. Documentation Writer, if PR, release, or issue text is needed.

### Task packet source

```md
## Task Packet

- Source: <issue URL, PR URL, or user request>
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

### Execution

- Planner must identify the owning source area and test area before Implementer edits TypeScript code.
- Implementer must edit only files listed in the task packet unless Planner updates the packet.
- Code Reviewer must check scope drift before style concerns.
- Verification Runner must run `npm run build` from `functions` after Firebase Functions changes.
- Verification Runner must run `npm test` from `functions` when behavior or tests changed, unless Planner records a narrower reason to skip it.

### Completion

Report:

```md
## Workflow Result

- Workflow: Issue-driven implementation
- Changed files:
- Data or deploy decision:
- Verification:
- Remaining decisions:
```

## Firebase Functions implementation

Use when the task changes Cloud Functions TypeScript, public behavior, tests, Firestore access, FCM notification behavior, Cloud Tasks payloads, REST handlers, or auth logic.

### Role order

1. Planner.
2. Firebase Operations Reviewer before editing, if data shape, retry, environment, index, or deploy risk exists.
3. Implementer.
4. Firebase Operations Reviewer after editing, if Firestore shape, retry behavior, environment, or deploy config changed.
5. Code Reviewer.
6. Verification Runner.

### Execution

- Keep production code free of test-purpose seams.
- Express behavior coverage as feature tests through existing public behavior.
- Keep `functions/src` changes separate from generated `functions/lib` output.
- Update `functions/.env.example` when a committed environment key is required.
- Do not read or commit local `.env` values.
- Do not deploy as part of implementation.

### Verification

Verification Runner must run:

```sh
cd functions
npm run build
```

Run this when behavior or tests changed:

```sh
cd functions
npm test
```

### Completion

Report:

```md
## Workflow Result

- Workflow: Firebase Functions implementation
- Changed files:
- Data or deploy decision:
- Verification:
- Remaining decisions:
```

## Firebase operations change

Use when the task changes `firebase.json`, `firestore.index.json`, `firestore.rules`, `functions/.env.example`, database routing, deployment scope, or production data handling.

### Role order

1. Planner.
2. Firebase Operations Reviewer before editing.
3. Implementer, only after Firebase Operations Reviewer returns `Pass`.
4. Firebase Operations Reviewer after editing.
5. Code Reviewer.
6. Verification Runner.

### Operations gate

Firebase Operations Reviewer must return:

- `Pass` before Implementer edits.
- `Block` when the requested change violates current rules or risks data loss without a migration plan.
- `Needs Owner Decision` when environment, database, deploy, or data cleanup policy requires user confirmation.

Implementer must not proceed on `Block` or `Needs Owner Decision`.

### Required inspection

- `firebase.json`
- `firestore.index.json`, when indexes or query shape changed
- `functions/.env.example`, when env keys changed
- README deploy and CI sections
- Relevant `functions/src` files
- Existing test files under `functions/test`

### Completion

Report:

```md
## Workflow Result

- Workflow: Firebase operations change
- Firebase Operations Reviewer verdict:
- Changed files:
- Data or deploy decision:
- Verification:
- Remaining decisions:
```

## Review-thread follow-up

Use when the user asks to address PR review comments or unresolved review threads.

### Role order

1. GitHub/CI Analyst.
2. Planner.
3. Firebase Operations Reviewer, if a requested fix touches data shape, environment, index, or deploy behavior.
4. Implementer.
5. Code Reviewer.
6. Verification Runner.
7. GitHub/CI Analyst, only if the user requested replies or thread resolution.

### Execution

- GitHub/CI Analyst must use thread-aware inspection when unresolved review threads matter.
- Planner must classify each comment as required, optional, already handled, or rejected.
- Implementer must apply only accepted fixes.
- Code Reviewer must verify that the final diff addresses the accepted comments without unrelated cleanup.
- GitHub/CI Analyst must mirror the existing PR reply style when replying.

### Completion

Report:

```md
## Workflow Result

- Workflow: Review-thread follow-up
- Addressed comments:
- Deferred or rejected comments:
- Changed files:
- Verification:
- GitHub actions:
```

## CI failure triage

Use when GitHub Actions or PR CI fails.

### Role order

1. GitHub/CI Analyst.
2. Planner.
3. Verification Runner, if a local reproduction is possible.
4. Implementer, only after a concrete root cause is identified.
5. Code Reviewer.
6. Verification Runner.

### Execution

- GitHub/CI Analyst must inspect the failing run, job, and log excerpts before proposing fixes.
- Planner must separate workflow failure, environment failure, dependency failure, and Functions build failure.
- Implementer must not edit workflow files until the failing step is identified.
- Verification Runner must not treat CI polling as a substitute for local verification when local checks are available.

### Completion

Report:

```md
## Workflow Result

- Workflow: CI failure triage
- Failing run:
- Root cause:
- Changed files:
- Verification:
- Remaining CI risk:
```

## Documentation-only writing

Use for PR body, issue text, release note, README wording, review reply draft, or user-facing explanation.

### Role order

1. Documentation Writer.
2. Code Reviewer, if wording must match a diff.
3. GitHub/CI Analyst, if live issue, PR, or release state matters.
4. Verification Runner, for file presence and Markdown checks when files changed.

### Execution

- Documentation Writer must inspect the actual diff before writing PR or release text.
- When the Documentation Writer role is required and `Spark` is available, the main agent must dispatch the draft to `gpt-5.3-codex-spark` or the configured `Spark` fallback before writing the final response.
- `Primary` must review the Documentation Writer output against the template, issue scope, and diff before returning or posting it.
- Do not write AI workflow documents under `docs/`.
- If the user asks only for text, return text directly and do not create files.
- If documentation files are changed, keep the change scoped to the requested document.

### Completion

Report:

```md
## Workflow Result

- Workflow: Documentation-only writing
- Target:
- Changed files:
- Source checked:
- Verification:
```

## AI workflow maintenance

Use for `AGENTS.md`, `AGENT_ROLES.md`, this file, or AI role routing changes.

### Role order

1. Planner.
2. Implementer.
3. Code Reviewer.
4. Verification Runner.

Firebase Operations Reviewer is required only if the change modifies Firebase deployment, environment, database, index, or data cleanup policy.

### Execution

- Keep AI workflow entry files at the repository root.
- Do not add AI workflow documents under `docs/`.
- `AGENTS.md` should stay the canonical entrypoint.
- `AGENT_ROLES.md` should define role permissions, output formats, and handoff packet shape.
- `AGENT_WORKFLOWS.md` should define executable role sequences.
- Do not copy iOS module, Tuist, Widget, StorePattern, or Swift workflow rules into this repository.

### Verification

Verification Runner must run:

```sh
git diff --check -- AGENTS.md AGENT_ROLES.md AGENT_WORKFLOWS.md
```

If only Markdown workflow files changed, no Functions build is required.

### Completion

Report:

```md
## Workflow Result

- Workflow: AI workflow maintenance
- Changed files:
- Operational change:
- Verification:
- Remaining decisions:
```

## Parallel dispatch guide

Parallelize only these combinations:

- GitHub/CI Analyst reading live GitHub state while Planner inspects local files.
- Firebase Operations Reviewer checking deploy or data risk while Code Reviewer checks non-operations risks after the diff is complete.
- Documentation Writer drafting PR text while Verification Runner runs checks, after the diff is stable.

Do not parallelize:

- Two Implementers over overlapping files.
- Implementer and Code Reviewer before Implementer finishes the diff.
- Verification Runner before the relevant files are saved.
- Firebase deploy actions with local code edits.
- GitHub write actions with local code edits.

## Role prompt snippets

Use the activation template from `AGENT_ROLES.md`, then set `<Role Name>` to one of:

- `Planner`
- `Implementer`
- `Code Reviewer`
- `Verification Runner`
- `Firebase Operations Reviewer`
- `GitHub/CI Analyst`
- `Documentation Writer`

Include the selected workflow name in the task packet `Source` or `Goal` field so the receiving model can align its output to this runbook.

## Task packet examples

### AI workflow maintenance example

```md
## Task Packet

- Source: User request
- Goal: Add repository-root AI role and workflow documents for DevLog Firebase.
- Scope: Update root AI workflow files only.
- Out of scope: TypeScript source, tests, Firebase deploy config, GitHub Actions, deploy actions.
- Expected changed files: `AGENTS.md`, `AGENT_ROLES.md`, `AGENT_WORKFLOWS.md`
- Current owner: repository workflow documentation
- Data or deploy risk: none
- Required roles: Planner, Implementer, Code Reviewer, Verification Runner
- Model assignment: Planner=Primary, Implementer=Primary, Code Reviewer=Spark, Verification Runner=Spark
- Verification: `git diff --check -- AGENTS.md AGENT_ROLES.md AGENT_WORKFLOWS.md`
- Stop conditions: request to change deploy policy, TypeScript source changes, Firebase config changes
```

### Firebase Functions implementation example

```md
## Task Packet

- Source: https://github.com/opficdev/DevLog_Firebase/issues/<number>
- Goal: Implement the requested Firebase Functions behavior.
- Scope: Change the owning `functions/src` files and feature tests through existing public behavior.
- Out of scope: unrelated cleanup, generated `functions/lib`, deploy, local `.env` values.
- Expected changed files: <filled by Planner after inspection>
- Current owner: <source area identified by Planner>
- Data or deploy risk: none / possible / confirmed
- Required roles: Planner, Implementer, Code Reviewer, Verification Runner
- Model assignment: Planner=Primary, Implementer=Primary, Code Reviewer=Spark -> Primary if blocking, Verification Runner=Spark
- Verification: `npm run build` from `functions`; `npm test` from `functions` when behavior or tests changed
- Stop conditions: data migration needed, env key missing, deploy required, test-purpose production seam requested
```
