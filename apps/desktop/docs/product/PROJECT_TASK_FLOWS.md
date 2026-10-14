- **Purpose:** Define the canonical, implementable UX flows for Projects and Tasks in BroPS Phase 1 — creation, workspace tabs, task lifecycle, task views, message-to-task and agent delegation, and project close.
- **Scope:** Project creation, project workspace tabs, task board/list lifecycle, the eight task views, create-task-from-message, assign-to-agent, the review→done evidence gate, project close, and the per-flow states every screen must handle. Trilingual product surface (HY/EN/RU).
- **Owner:** Gev.
- **Related:** [WORKSPACES.md](WORKSPACES.md), [NAVIGATION.md](NAVIGATION.md), [../architecture/AI_RUNTIME.md](../architecture/AI_RUNTIME.md), [DECISION_APPROVAL_FLOWS.md](DECISION_APPROVAL_FLOWS.md).
- **Last updated:** 2026-10-14. *(This line said 2026-07-19 while the file was changed on 2026-10-02 and 2026-10-08.)*

# Project & Task Flows

Status: Draft canonical

This document is the detailed UX contract for the **Projects** and **Tasks** workspaces defined in [WORKSPACES.md](WORKSPACES.md) and projected in [NAVIGATION.md](NAVIGATION.md). Every execution, delegation, evidence, and approval rule defers to [../architecture/AI_RUNTIME.md](../architecture/AI_RUNTIME.md); no flow here may weaken those rules. Where a flow prepares a protected action or a recordable choice, it hands off to [DECISION_APPROVAL_FLOWS.md](DECISION_APPROVAL_FLOWS.md).

## 1. Canonical vocabulary

- **Project** — objective-centered container linking tasks, people, agents, files, decisions, knowledge, risks, timeline, and outcome.
- **Task** — a single unit of action with one owner (human or agent), status, priority, deadline, dependencies, evidence, blockers, and completion criteria.
- **Owner** — the accountable party for a task. Exactly one, either Gev, a collaborator, or a named agent.
- **Evidence** — verifiable proof a result happened: commit SHA, file checksum, API response id, test output, screenshot, or verified state readback.
- **Approval level** — A0 (none), A1 (policy-preapproved), A2 (explicit), A3 (dual confirmation), per the Approval model in AI_RUNTIME.

## 2. Project creation flow

Entry points: **Projects → New**, Home quick action, Command workspace ("start a project…"), or **Create project** from a Group Chat room.

**Step 1 — Choose a start.** A two-choice picker:
- **From template** — reusable project shape from the Library (e.g. "Product spec", "Release", "Research"). Pre-fills tabs, a starter task set, default agent roles, and success-criteria placeholders.
- **Blank** — empty project; the owner defines everything.

**Step 2 — Define the objective (required fields).** A single form, validated before Bro plans:
- **Objective** (required, free text) — the outcome the project exists to produce.
- **Constraints** (optional, repeatable) — budget, tech, policy, scope limits.
- **Owner** (required, default Gev) — accountable human.
- **Deadline** (optional) — target date; feeds Timeline and Calendar pressure.
- **Success criteria** (required, ≥1) — checkable statements that define "done" for the whole project.

**Step 3 — Bro proposes.** On submit, Bro reads objective, constraints, and success criteria and returns a **proposal card**, not an executed plan:
- a decomposed **plan** (milestones → candidate tasks with priority and rough dependencies),
- **agent assignments** (which specialist role per task cluster, with authority limits),
- surfaced **risks / open questions** requiring an owner decision.

The proposal is editable inline. Nothing is created until the owner **Accepts**. Accepting creates the project, its starter tasks in `planned`, and the agent bindings (agents are bound but not yet run). Editing then re-accepting re-proposes only the changed branch. **Discard** leaves no project.

Events: `project.proposed` → `project.created`; each starter task emits `task.created`.

Per-flow states: **loading** (Bro planning — skeleton proposal card with a cancel control); **empty** (no template chosen and no objective typed — inline guidance, submit disabled); **error** (planning failed — keep the entered form, offer retry, never fabricate a plan); **offline** (draft is saved locally, submit deferred with a "will create when online" note); **permission-denied** (user lacks create-project right — read-only preview, request-access CTA); **awaiting-approval** (only if a template pulls in a protected action, e.g. external integration — the offending item is held, rest proceeds).

## 3. Project workspace tabs

Every project exposes the ten tabs from NAVIGATION.md. Each tab lists what it shows and its primary actions.

| Tab | Shows | Primary actions |
| --- | --- | --- |
| **Overview** | Objective, success-criteria progress, owner, deadline, health, active agents, blockers, pending approvals, next tasks. | Edit objective/criteria, open blocker, jump to any tab. |
| **Group Chat** | The project room (humans + agents), mentions, threads, summaries. Bound 1:1 to the project. | Post, mention agent, create task/decision/approval from a message. |
| **Tasks** | Board and list of every task with owner, status, priority, deadline, dependencies, evidence, blockers. | New task, change status, assign owner/agent, set deadline/priority, link dependency. |
| **Files** | Managed files with preview, provenance, versioning, links, permissions. | Upload, preview, link to task/decision, set permissions. |
| **Knowledge** | Verified reusable info scoped to the project, with source, owner, version, freshness. | Add/verify knowledge, cite in a task, resolve conflict. |
| **Decisions** | Accepted choices with context, alternatives, rationale, owner, effective date, supersession. | Propose decision, review, approve/reject (per DECISION_APPROVAL_FLOWS.md). |
| **Agents** | Agents bound to the project: identity, capability, permissions, scope, current work, health, cost. | Bind/unbind agent, adjust scope, pause, inspect audit. |
| **Timeline** | Milestones, deadlines, dependencies, and scheduled work over time. | Reschedule, view critical path, set milestone. |
| **Activity** | Chronological, filterable record of user, agent, tool, system, and automation events. | Filter, open source object, export. |
| **Settings** | Name, objective, members and roles, default agent scope, permissions, archival/close controls. | Edit metadata, manage members, close/archive project. |

Per-tab states apply uniformly: **loading** (per-tab skeleton, tab shell stays interactive); **empty** (purpose-specific first-run prompt, e.g. Tasks → "No tasks yet — create one or let Bro propose"); **error** (tab-local error with retry, siblings unaffected); **offline** (last synced snapshot with a staleness badge, writes queued); **permission-denied** (tab hidden or shown read-only per role); **blocked / awaiting-approval** (surfaced as banners on Overview and inline on the owning object).

> **Not reconciled (2026-10-14):** `permission-denied` here lets a tab be **hidden**, and §5 below lets a view be hidden, while §8 of this document says "a denied action is never hidden" and [STATES.md](STATES.md) §6 gives a whole surface a visible "You don't have access" state. STATES.md's opening paragraph says it wins where a screen conflicts with it; by that rule both sentences would read "shown, with the access-restricted state". They are left as written until that is confirmed. The code does not settle it: there are no roles — no migration creates a users, roles or members table — a project page has two tabs, Overview and Tasks (`src/features/Projects.tsx`), and the one denial that is rendered is a failed list command shown as an error panel prefixed "Not permitted" (`Async` in `src/components/ui.tsx`).

## 4. Task lifecycle (board & list UX)

Tasks render two ways over the same data:
- **Board** — one column per state: **Planned · Active · Blocked · Review · Done · Cancelled**. Drag a card to change state; illegal moves are refused with a reason.
- **List** — same tasks as sortable/filterable rows (by owner, priority, deadline, dependency, agent vs human).

**Task card fields:** title, owner avatar (human or agent badge), status chip, priority (Low/Med/High/Urgent), deadline (with overdue styling), dependency count, evidence indicator, blocker flag, agent-run indicator.

*(Read against the code 2026-10-14.)* "Low/Med/High/Urgent" above is the specification's vocabulary. The shipped priority values are `low`, `normal`, `high` and `critical` — `Priority` in `src/domain/enums.ts` and `PRIORITIES` in `src-tauri/core/src/domain.rs`, the same four — shown as Low, Normal, High and Critical (`src/domain/statusLabels.ts`). The store refuses any other value on create and on update (`is_valid(…, PRIORITIES)` in `src-tauri/core/src/repo.rs`), so no task can hold "Med" or "Urgent", and a new task defaults to `normal`.

**State model** (canonical, matches [USER_FLOWS.md](USER_FLOWS.md) §3 Project Execution — AI_RUNTIME has no section of that name):

`inbox → planned → active → blocked → review → done`, with `cancelled` reachable from any non-terminal state.

- **inbox** — where every task is created: the column default in `core/schema/0001_initial.sql` and the literal `repo::tasks::create` inserts. Captured, not yet triaged. This model listed six states and the store has had seven since the first migration.

- **planned** — defined, not started. Has owner, criteria; may have unmet dependencies (shown, and start is gated until they clear).
- **active** — owner (human or agent) is working. For agent owners this maps to the agent execution model `assigned → accepted → running` (see §6).
- **blocked** — cannot proceed; requires a **blocker reason** and, ideally, an unblock owner. A task in blocked never silently returns to active — someone resolves the blocker.
- **review** — work is claimed complete and awaiting the evidence gate. Entry to review **requires attached evidence**; without evidence the transition is refused (the "no completion without evidence" rule).
- **done** — reviewer confirmed the completion criteria are met against the evidence. Terminal.
- **cancelled** — intentionally stopped; requires a reason. Terminal. Dependents are notified.

**Rules enforced by the UI:**
1. A task cannot enter **review** without evidence, nor **done** without an accepted review.
2. Changing owner between human and agent is allowed at any non-terminal state and is recorded.
3. Dependencies block **start** (planned→active), not creation.
4. Every state transition emits a `task.changed` event; done/cancelled record who and why.
5. Priority and deadline are editable in any non-terminal state.

Per-flow states: **loading** (board columns skeleton); **empty** (no tasks — "Create task" and "Let Bro propose tasks" CTAs); **error** (a failed transition rolls the card back to its prior column with an inline reason); **offline** (drag changes queue locally, card shows a pending-sync badge); **permission-denied** (drag disabled, card shows a lock, tooltip explains the missing right); **blocked** (dedicated column + red flag + reason on hover); **awaiting-approval** (card shows an amber approval chip; the state change is held until the approval in DECISION_APPROVAL_FLOWS.md resolves).

## 5. Task views and how items move

The eight global views from NAVIGATION.md are **saved filters over all tasks**, not separate stores. A task appears in every view whose condition it matches, and moves between views automatically as its fields change — no manual filing.

| View | Membership condition | An item leaves when… |
| --- | --- | --- |
| **Inbox** | New or newly assigned to the viewer, not yet triaged. | It is triaged (given priority/deadline/state) or scheduled. |
| **Today** | Deadline is today, or owner scheduled it for today. | Deadline/schedule moves, or it reaches done/cancelled. |
| **Assigned to me** | Owner = current human user, state non-terminal. | Owner changes, or task is done/cancelled. |
| **Assigned to agents** | Owner is any agent, state non-terminal. | Reassigned to a human, or done/cancelled. |
| **Waiting approval** | Task has an open approval (A2/A3) blocking a transition. | Approval is granted, rejected, or expires. |
| **Blocked** | State = blocked. | Blocker is resolved (→ active) or task cancelled. |
| **Recurring** | Task has a recurrence rule. | Recurrence is removed; each instance also flows through the other views. |
| **Completed** | State = done or cancelled. | (Terminal — items stay, filterable by date.) |

Movement is a side effect of field changes, always driven by an event, never a hidden migration. Example: an agent-owned task that finishes and posts evidence moves out of **Assigned to agents**, into **Waiting approval** (if a reviewer approval is required) or **Review**, then to **Completed** on done.

> **Not reconciled (2026-10-14):** this example does not follow the table above it. By the table a task leaves **Assigned to agents** only when it is reassigned to a human or reaches done/cancelled, and a task in review is still agent-owned and non-terminal, so it would stay there; and **Review** is not one of the eight views — it is a task state (§4). Either the example is wrong, or the table is missing a leave condition and a ninth view. Which has not been decided. The code does not settle it: none of the eight views is built. The Tasks page groups tasks into four lanes by status, with `review` in the same lane as `active` (`LANES` in `src/features/Tasks.tsx`).

Per-flow states per view: **loading** (row skeletons); **empty** (view-specific reassurance, e.g. Inbox → "You're all caught up"); **error** (retry banner, cached rows if any); **offline** (last snapshot + staleness badge); **permission-denied** (view hidden if the user may see no matching tasks); **blocked / awaiting-approval** (Blocked and Waiting-approval views are themselves the surfacing of those states).

> **Not reconciled (2026-10-14):** "view hidden" here is the same conflict as the hidden tab in §3 — see the marker there.

## 6. Create task from message & assign to agent

### 6.1 Create task from message
In any Group Chat (project or team room), a message action **Create task from message** opens a pre-filled task composer: title from the message, description carrying the quote and a back-link to the source message, project pre-set (project rooms) or chosen (team rooms), owner defaulting to the mentioned party. Owner confirms or edits, then creates. The task starts in **inbox** (the store's creation default), is linked to the message, and emits `task.created`. The source message shows a "→ task" chip.

### 6.2 Assign to agent
Assigning a task to an agent (from the task, the board, or a chat mention like `@Forge take this`) opens the **delegation contract** required by AI_RUNTIME. The owner must confirm, and the UI must show:
1. Objective, 2. Context provided, 3. Allowed scope, 4. Expected output, 5. Completion evidence required, 6. Deadline / stop condition, 7. Approval boundary (which actions inside the run need A2/A3).

On confirm, the task's owner becomes the agent and it moves to **active**; the agent transitions `assigned → accepted → running`. An agent may not receive more authority than the command grants.

### 6.3 Agent run producing evidence
While running, the task streams the agent's live status (Thinking, Working, Waiting approval, Blocked) and any tool calls. Rules from AI_RUNTIME hold:
- A tool result is not success until verified; the agent captures the declared evidence.
- If the run needs an action outside its approval boundary, it moves to **Waiting approval** and pauses — never bypasses the gate.
- The agent may only report: completed-with-evidence, partially-completed-with-evidence, blocked-with-reason, failed-with-reason, or not-started. Vague progress is invalid.

On honest completion the agent attaches evidence and moves the task to **review** (agent execution: `completed`). A failed run moves the task to **blocked** with a reason, not to done.

### 6.4 Review → done gate
A human reviewer (default the project owner) opens the review: the completion criteria are shown beside the attached evidence. The reviewer:
- **Approve** → task to **done**; emits `task.completed`.
- **Request changes** → back to **active** (human) or re-delegated (agent), with review notes.
- **Reject** → to **blocked** or **cancelled** with reason.

Done is impossible without this gate. Bro reports the task complete only when execution evidence and verification both exist.

Per-flow states: **loading** (agent connecting / evidence rendering skeleton); **empty** (no evidence yet — review action disabled with "awaiting evidence"); **error** (agent/tool failure surfaced verbatim, task to blocked, retry/reassign offered); **offline** (run cannot start; queued with a note; an in-flight run's last known state is shown stale); **permission-denied** (user cannot delegate to that agent or cannot review — action visible but disabled, with the reason; STATES.md §6); **blocked** (blocker reason mandatory, unblock owner suggested); **awaiting-approval** (run paused on an approval chip; resolving it in DECISION_APPROVAL_FLOWS.md resumes or cancels the run).

## 7. Project close flow

Closing is gated, never a single button that just archives.

**Step 1 — Completion-criteria review.** Every success criterion from creation is shown with its met/unmet state and the evidence that satisfies it. Unmet criteria block a clean close.

**Step 2 — Unresolved-risk review.** Open blockers, tasks not in a terminal state, unresolved decisions, and open approvals are listed. For each, the owner must **resolve**, **explicitly accept as residual risk** (recorded), or **carry over** to another project.

**Step 3 — Close decision.** The owner chooses:
- **Close as completed** — allowed only when criteria are met (or residual risks explicitly accepted). Emits `project.closed`, snapshots evidence, moves the project to read-only Completed.
- **Close as cancelled** — requires a reason; dependents and bound agents are released and notified.
- **Archive** — reversible; hides from active lists, keeps everything intact.

Closing releases agent bindings and stops recurring tasks in the project.

Per-flow states: **loading** (criteria/risk aggregation skeleton); **empty** (no criteria defined — close is blocked until criteria exist or are waived with a reason); **error** (aggregation failed — do not allow close on incomplete data); **offline** (close deferred; preview allowed, commit queued); **permission-denied** (only owner/authorized role may close — others see status only); **blocked** (unmet criteria or open A3 approvals hard-block completed-close until resolved or accepted); **awaiting-approval** (if closing itself is a protected action, it enters the approval queue).

## 8. Global state contract

Every flow above must render the following seven states honestly — seven of the ten canonical states in [STATES.md](STATES.md), which also defines `populated`, `destructive-confirmation` and `success`; none may hide execution, approval, ownership, failure, or uncertainty (Global Rule, USER_FLOWS.md):

- **loading** — skeletons, not blank; keep the shell interactive and cancelable.
- **empty** — purposeful first-run guidance with the primary CTA, never a dead end.
- **error** — precise, verbatim where safe; preserve user input; offer retry; never fabricate success.
- **offline** — last synced snapshot with a staleness badge; writes queue and replay idempotently.
- **permission-denied** — read-only, or visible but disabled per role (STATES.md §6: a denied action is never hidden), with a request-access path; never a silent failure.
- **blocked** — visible reason and, where possible, an unblock owner and path.
- **awaiting-approval** — the pending action, its scope, impact, and expiry are shown; execution is held until the approval resolves.

> **Not reconciled (2026-10-14):** "every flow above must render the following seven" does not hold for §2. The per-flow states of project creation are six — loading, empty, error, offline, permission-denied, awaiting-approval — with no **blocked**; §3–§7 each list all seven. Either §2 is missing a blocked state or the sentence means "each where it applies", the wording [SCREEN_INVENTORY.md](SCREEN_INVENTORY.md) and [INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md) §1.3 use for the canonical set. Which has not been decided. The code does not settle it: the creation flow of §2 is not built — a project is created from a name, a description and a priority (`createProject` in `src/features/Projects.tsx`), with no template, objective form or proposal card.

---

# Հայերեն

Կարգավիճակ՝ Draft canonical

Այս փաստաթուղթը **Projects** և **Tasks** աշխատանքային տարածքների մանրամասն UX պայմանագիրն է ([WORKSPACES.md](WORKSPACES.md), [NAVIGATION.md](NAVIGATION.md))։ Կատարման, delegation-ի, evidence-ի և approval-ի բոլոր կանոնները ենթարկվում են [../architecture/AI_RUNTIME.md](../architecture/AI_RUNTIME.md)-ին. այստեղ ոչ մի հոսք չի կարող թուլացնել դրանք։ Երբ հոսքը պատրաստում է պաշտպանված գործողություն կամ գրանցելի ընտրություն, այն փոխանցում է [DECISION_APPROVAL_FLOWS.md](DECISION_APPROVAL_FLOWS.md)-ին։

## 1. Կանոնական բառապաշար

- **Project (Նախագիծ)** — նպատակակենտրոն container, որ կապում է task-երը, մարդկանց, agent-ներին, ֆայլերը, decision-ները, knowledge-ը, ռիսկերը, timeline-ն ու արդյունքը։
- **Task (Առաջադրանք)** — գործողության մեկ միավոր՝ մեկ owner-ով (մարդ կամ agent), status-ով, priority-ով, deadline-ով, dependency-ներով, evidence-ով, blocker-ներով և completion criteria-ով։
- **Owner (Պատասխանատու)** — task-ի հաշվետու կողմը։ Ուղիղ մեկը՝ Gev, collaborator կամ անվանված agent։
- **Evidence (Ապացույց)** — ստուգելի փաստ, որ արդյունքը տեղի է ունեցել՝ commit SHA, ֆայլի checksum, API response id, թեստի արդյունք, screenshot կամ վիճակի վերահաստատում։
- **Approval level** — A0 (առանց), A1 (policy-preapproved), A2 (բացահայտ), A3 (կրկնակի հաստատում)՝ ըստ AI_RUNTIME-ի Approval մոդելի։

## 2. Նախագծի ստեղծման հոսք

Մուտքի կետեր՝ **Projects → New**, Home-ի արագ գործողություն, Command տարածք («start a project…») կամ Group Chat սենյակից **Create project**։

**Քայլ 1 — Ընտրիր start-ը.** Երկու տարբերակ՝
- **From template** — Library-ից վերաօգտագործվող ձև (օր.՝ «Product spec», «Release», «Research»). նախալրացնում է tab-երը, սկզբնական task-երը, default agent role-երն ու success-criteria placeholder-ները։
- **Blank** — դատարկ նախագիծ. owner-ը սահմանում է ամեն ինչ։

**Քայլ 2 — Սահմանիր objective-ը (պարտադիր դաշտեր).** Մեկ ֆորմ, որ վավերացվում է մինչ Bro-ի պլանավորումը՝
- **Objective** (պարտադիր) — արդյունքը, որի համար գոյություն ունի նախագիծը։
- **Constraints** (ոչ պարտադիր, կրկնվող) — budget, tech, policy, scope սահմաններ։
- **Owner** (պարտադիր, default Gev) — հաշվետու մարդ։
- **Deadline** (ոչ պարտադիր) — թիրախ ամսաթիվ. սնուցում է Timeline-ն ու Calendar-ը։
- **Success criteria** (պարտադիր, ≥1) — ստուգելի պնդումներ, որ սահմանում են ամբողջ նախագծի «done»-ը։

**Քայլ 3 — Bro-ն առաջարկում է.** Submit-ից հետո Bro-ն կարդում է objective-ը, constraints-ը և success criteria-ն և վերադարձնում **proposal card**, ոչ թե կատարված պլան՝
- քայքայված **plan** (milestone-ներ → թեկնածու task-եր՝ priority-ով և մոտավոր dependency-ներով),
- **agent assignments** (որ specialist role-ը՝ որ task cluster-ին, authority limit-ներով),
- բացահայտված **ռիսկեր / բաց հարցեր**, որ owner-ի որոշում են պահանջում։

Proposal-ը inline խմբագրելի է։ Ոչինչ չի ստեղծվում, մինչ owner-ը **Accept** անի։ Accept-ը ստեղծում է նախագիծը, նրա սկզբնական task-երը `planned` վիճակում և agent binding-ները (agent-ները կապվում են, բայց դեռ չեն աշխատում)։ Խմբագրելուց հետո կրկնակի accept-ը վերառաջարկում է միայն փոփոխված ճյուղը։ **Discard**-ը նախագիծ չի թողնում։

Events՝ `project.proposed` → `project.created`. յուրաքանչյուր սկզբնական task տալիս է `task.created`։

Վիճակներ ըստ հոսքի՝ **loading** (Bro-ն պլանավորում է — proposal card-ի skeleton՝ cancel-ով). **empty** (template չընտրված և objective չգրված — inline ուղղորդում, submit-ը անջատված). **error** (պլանավորումը ձախողվեց — պահել ֆորմը, առաջարկել retry, երբեք չհորինել պլան). **offline** (draft-ը պահվում է լոկալ, submit-ը հետաձգվում է). **permission-denied** (create-project իրավունք չկա — read-only preview, request-access). **awaiting-approval** (եթե template-ը բերում է պաշտպանված գործողություն — խնդրահարույց item-ը պահվում է, մնացածը շարունակվում է)։

## 3. Նախագծի աշխատանքային tab-երը

Յուրաքանչյուր նախագիծ բացում է NAVIGATION.md-ի տասը tab-երը։ Յուրաքանչյուրի համար՝ ինչ է ցույց տալիս և primary գործողությունները։

| Tab | Ցույց է տալիս | Primary գործողություններ |
| --- | --- | --- |
| **Overview** | Objective, success-criteria progress, owner, deadline, health, active agents, blocker-ներ, pending approval-ներ, հաջորդ task-երը։ | Խմբագրել objective/criteria, բացել blocker, անցնել tab։ |
| **Group Chat** | Նախագծի սենյակը (մարդ + agent), mention-ներ, thread-եր, summary-ներ. կապված 1:1 նախագծին։ | Post, mention agent, հաղորդագրությունից task/decision/approval ստեղծել։ |
| **Tasks** | Board և list՝ ամեն task owner-ով, status-ով, priority-ով, deadline-ով, dependency-ով, evidence-ով, blocker-ով։ | Նոր task, status փոխել, owner/agent նշանակել, deadline/priority դնել, dependency կապել։ |
| **Files** | Ֆայլեր՝ preview, provenance, versioning, links, permissions։ | Upload, preview, կապել task/decision-ի, permission դնել։ |
| **Knowledge** | Նախագծի scope-ի ստուգված knowledge՝ source, owner, version, freshness։ | Ավելացնել/ստուգել knowledge, task-ում մեջբերել, conflict լուծել։ |
| **Decisions** | Ընդունված ընտրություններ՝ context, alternatives, rationale, owner, effective date, supersession։ | Decision առաջարկել, review, approve/reject (ըստ DECISION_APPROVAL_FLOWS.md)։ |
| **Agents** | Նախագծին կապված agent-ներ՝ identity, capability, permissions, scope, current work, health, cost։ | Agent bind/unbind, scope փոխել, pause, audit դիտել։ |
| **Timeline** | Milestone-ներ, deadline-ներ, dependency-ներ և ժամանակի ընթացքում պլանավորված աշխատանք։ | Reschedule, critical path դիտել, milestone դնել։ |
| **Activity** | Ժամանակագրական, ֆիլտրվող գրառում՝ user, agent, tool, system, automation event-երի։ | Ֆիլտրել, բացել source object, export։ |
| **Settings** | Անուն, objective, members ու role-եր, default agent scope, permissions, archival/close controls։ | Metadata խմբագրել, members կառավարել, close/archive։ |

Tab-երի վիճակները կիրառվում են միատեսակ՝ **loading** (tab-ի skeleton, tab shell-ը մնում է interactive). **empty** (first-run prompt, օր. Tasks → «Դեռ task չկա — ստեղծիր կամ թող Bro-ն առաջարկի»). **error** (tab-local error՝ retry-ով, հարևանները չեն ազդվում). **offline** (վերջին sync snapshot՝ staleness badge-ով, գրառումները հերթ). **permission-denied** (tab-ը թաքցվում է կամ read-only ըստ role-ի). **blocked / awaiting-approval** (banner Overview-ի վրա և inline՝ տվյալ object-ի վրա)։

> **Չհամաձայնեցված (2026-10-14)․** այստեղի `permission-denied`-ը թույլ ա տալիս tab-ը **թաքցնել**, ու ներքևի §5-ը՝ view-ն թաքցնել, մինչդեռ այս փաստաթղթի §8-ն ասում ա «մերժված գործողությունը երբեք չի թաքցվում», ու [STATES.md](STATES.md) §6-ը ամբողջ surface-ին տալիս ա տեսանելի «You don't have access» վիճակ։ STATES.md-ի բացող պարբերությունն ասում ա, որ ինքն ա հաղթում, երբ էկրանը հակասում ա իրեն. այդ կանոնով երկու նախադասությունն էլ կկարդացվեին «ցուցադրվում ա՝ access-restricted վիճակով»։ Դրանք թողնված են ինչպես գրված են, մինչև դա հաստատվի։ Կոդը չի լուծում՝ role-եր չկան (ոչ մի migration users, roles կամ members աղյուսակ չի ստեղծում), project-ի էջը երկու tab ունի՝ Overview ու Tasks (`src/features/Projects.tsx`), ու միակ մերժումը, որ render ա լինում, ձախողված list command-ն ա՝ ցույց տրված որպես error panel «Not permitted» նախածանցով (`Async`՝ `src/components/ui.tsx`-ում)։

## 4. Task-ի կյանքի ցիկլ (board և list UX)

Task-երը նույն տվյալի վրա երկու տեսքով՝
- **Board** — մեկ սյուն մեկ վիճակի համար՝ **Planned · Active · Blocked · Review · Done · Cancelled**։ Card-ը քաշելով՝ վիճակը փոխվում է. անթույլատրելի քայլերը մերժվում են պատճառով։
- **List** — նույն task-երը որպես sort/filter տողեր (owner, priority, deadline, dependency, agent vs human)։

**Task card-ի դաշտերը՝** վերնագիր, owner avatar (մարդ կամ agent badge), status chip, priority (Low/Med/High/Urgent), deadline (overdue styling-ով), dependency count, evidence indicator, blocker flag, agent-run indicator։

*(Կոդի դեմ կարդացված 2026-10-14։)* Վերևի «Low/Med/High/Urgent»-ը սպեցիֆիկացիայի բառապաշարն ա։ Shipped priority-ի արժեքներն են `low`, `normal`, `high` ու `critical`՝ `Priority`-ն `src/domain/enums.ts`-ում ու `PRIORITIES`-ը `src-tauri/core/src/domain.rs`-ում, նույն չորսը, որ ցուցադրվում են որպես Low, Normal, High ու Critical (`src/domain/statusLabels.ts`)։ Պահեստը ուրիշ ցանկացած արժեք մերժում ա ստեղծելիս ու թարմացնելիս (`is_valid(…, PRIORITIES)`՝ `src-tauri/core/src/repo.rs`-ում), ուրեմն ոչ մի task չի կարող «Med» կամ «Urgent» ունենալ, ու նոր task-ի default-ը `normal`-ն ա։

**Վիճակների մոդել** (կանոնական, համընկնում է [USER_FLOWS.md](USER_FLOWS.md) §3 Project Execution-ին — AI_RUNTIME-ում այդ անունով բաժին չկա)՝

`planned → active → blocked → review → done`, իսկ `cancelled`-ը հասանելի է ցանկացած ոչ-terminal վիճակից։

- **planned** — սահմանված, չսկսած։ Ունի owner, criteria. կարող է ունենալ չբավարարված dependency (ցուցադրվում է, start-ը փակ է մինչ դրանց լուծումը)։
- **active** — owner-ը (մարդ կամ agent) աշխատում է։ Agent owner-ի դեպքում սա համապատասխանում է agent execution մոդելին՝ `assigned → accepted → running` (§6)։
- **blocked** — չի կարող առաջ գնալ. պահանջում է **blocker reason** և ցանկալի է unblock owner։ Blocked-ից երբեք լուռ չի վերադառնում active. ինչ-որ մեկը լուծում է blocker-ը։
- **review** — աշխատանքը հայտարարված է ավարտված և սպասում է evidence gate-ին։ Review մուտքը **պահանջում է կցված evidence**. առանց դրա անցումը մերժվում է («no completion without evidence»)։
- **done** — reviewer-ը հաստատել է, որ completion criteria-ն բավարարված են evidence-ի դիմաց։ Terminal։
- **cancelled** — դիտավորյալ դադարեցված. պահանջում է պատճառ։ Terminal։ Dependent-ները ծանուցվում են։

**UI-ի կիրառվող կանոններ՝**
1. Task-ը չի կարող մտնել **review** առանց evidence-ի, ոչ էլ **done** առանց ընդունված review-ի։
2. Owner-ի փոփոխությունը մարդ ↔ agent թույլատրված է ցանկացած ոչ-terminal վիճակում և գրանցվում է։
3. Dependency-ները փակում են **start**-ը (planned→active), ոչ թե ստեղծումը։
4. Ամեն անցում տալիս է `task.changed` event. done/cancelled-ը գրանցում է՝ ով և ինչու։
5. Priority-ն ու deadline-ը խմբագրելի են ցանկացած ոչ-terminal վիճակում։

Վիճակներ ըստ հոսքի՝ **loading** (board-ի skeleton). **empty** (task չկա — «Create task» և «Let Bro propose» CTA-ներ). **error** (ձախողված անցումը card-ը վերադարձնում է նախորդ սյուն՝ inline պատճառով). **offline** (drag-ը հերթ, pending-sync badge). **permission-denied** (drag-ն անջատված, lock, tooltip-ը բացատրում է). **blocked** (առանձին սյուն + կարմիր flag + պատճառ). **awaiting-approval** (amber approval chip. վիճակի փոփոխությունը պահվում է մինչ DECISION_APPROVAL_FLOWS.md-ի approval-ի լուծումը)։

## 5. Task view-երը և ինչպես են item-երը շարժվում

NAVIGATION.md-ի ութ գլոբալ view-երը **բոլոր task-երի վրա պահված ֆիլտրեր են**, ոչ առանձին պահեստներ։ Task-ը հայտնվում է ամեն view-ում, որի պայմանին համապատասխանում է, և ինքնաշարժ անցնում view-երի միջև, երբ դաշտերը փոխվում են՝ առանց ձեռքով դասավորելու։

| View | Անդամության պայման | Item-ը դուրս է գալիս, երբ… |
| --- | --- | --- |
| **Inbox** | Նոր կամ նոր նշանակված viewer-ին, դեռ չտրիաժված։ | Տրիաժվում է (priority/deadline/state) կամ պլանավորվում։ |
| **Today** | Deadline-ը այսօր է, կամ owner-ը այսօրվա համար է պլանավորել։ | Deadline/schedule փոխվում է, կամ done/cancelled։ |
| **Assigned to me** | Owner = ընթացիկ մարդ user, ոչ-terminal։ | Owner փոխվում է, կամ done/cancelled։ |
| **Assigned to agents** | Owner = որևէ agent, ոչ-terminal։ | Վերանշանակվում է մարդու, կամ done/cancelled։ |
| **Waiting approval** | Task-ը ունի բաց approval (A2/A3), որ փակում է անցումը։ | Approval-ը տրվում է, մերժվում կամ ժամկետանց։ |
| **Blocked** | State = blocked։ | Blocker-ը լուծվում է (→ active) կամ cancelled։ |
| **Recurring** | Task-ը ունի recurrence rule։ | Recurrence-ը հանվում է. ամեն instance-ը նաև հոսում է մյուս view-երով։ |
| **Completed** | State = done կամ cancelled։ | (Terminal — մնում են, ֆիլտրվում ըստ ամսաթվի)։ |

Շարժը դաշտի փոփոխության կողմնակի հետևանք է, միշտ event-ով, երբեք թաքնված migration։ Օրինակ՝ agent-owned task, որ ավարտվում և evidence է հրապարակում, դուրս է գալիս **Assigned to agents**-ից, մտնում **Waiting approval** (եթե reviewer approval է պետք) կամ **Review**, ապա done-ի դեպքում՝ **Completed**։

> **Չհամաձայնեցված (2026-10-14)․** այս օրինակը չի հետևում իր վերևի աղյուսակին։ Աղյուսակով task-ը **Assigned to agents**-ից դուրս ա գալիս միայն երբ վերանշանակվում ա մարդու կամ հասնում ա done/cancelled, իսկ review-ում գտնվող task-ը դեռ agent-owned ու ոչ-terminal ա, ուրեմն կմնար այնտեղ. ու **Review**-ը ութ view-ից մեկը չի՝ այն task-ի վիճակ ա (§4)։ Կամ օրինակն ա սխալ, կամ աղյուսակին պակասում ա դուրս գալու պայման ու իններորդ view։ Թե որը՝ որոշված չի։ Կոդը չի լուծում՝ ութ view-ից ոչ մեկը կառուցված չի։ Tasks էջը task-երը խմբավորում ա չորս lane-ի ըստ status-ի, `review`-ն `active`-ի հետ նույն lane-ում (`LANES`՝ `src/features/Tasks.tsx`-ում)։

Վիճակներ ըստ view-ի՝ **loading** (row skeleton). **empty** (view-specific հանգստացում, օր. Inbox → «Ամեն ինչ մաքուր է»). **error** (retry banner, cached տողեր). **offline** (վերջին snapshot + staleness). **permission-denied** (view-ը թաքցվում է, եթե user-ը match task չի տեսնում). **blocked / awaiting-approval** (Blocked և Waiting-approval view-երն իրենք այդ վիճակների բացահայտումն են)։

> **Չհամաձայնեցված (2026-10-14)․** այստեղի «view-ը թաքցվում է»-ն նույն հակասությունն ա, ինչ §3-ի թաքցվող tab-ը՝ տես այնտեղի նշումը։

## 6. Task ստեղծել հաղորդագրությունից և նշանակել agent-ի

### 6.1 Task ստեղծել հաղորդագրությունից
Ցանկացած Group Chat-ում (project կամ team room) հաղորդագրության **Create task from message** գործողությունը բացում է նախալրացված task composer՝ վերնագիրը հաղորդագրությունից, description-ը՝ մեջբերումով և source-ի back-link-ով, project-ը նախադրված (project room) կամ ընտրվող (team room), owner-ը՝ default-ով mention արված կողմը։ Owner-ը հաստատում կամ խմբագրում է, ապա ստեղծում։ Task-ը սկսում է **planned**-ից, կապվում է հաղորդագրությանը, տալիս `task.created`։ Source հաղորդագրությունը ցույց է տալիս «→ task» chip։

### 6.2 Նշանակել agent-ի
Task-ը agent-ի նշանակելը (task-ից, board-ից կամ `@Forge take this` mention-ից) բացում է AI_RUNTIME-ի պահանջած **delegation contract**-ը։ Owner-ը պետք է հաստատի, և UI-ն պետք է ցույց տա՝
1. Objective, 2. Տրված context, 3. Allowed scope, 4. Expected output, 5. Պահանջվող completion evidence, 6. Deadline / stop condition, 7. Approval boundary (որ գործողությունները run-ի ներսում պահանջում են A2/A3)։

Հաստատումից հետո task-ի owner-ը դառնում է agent-ը, և այն անցնում է **active**. agent-ը՝ `assigned → accepted → running`։ Agent-ը չի կարող ստանալ command-ից ավելի լայն authority։

### 6.3 Agent-ի run, որ evidence է արտադրում
Run-ի ընթացքում task-ը հեռարձակում է agent-ի live status-ը (Thinking, Working, Waiting approval, Blocked) և tool call-երը։ AI_RUNTIME-ի կանոնները պահվում են՝
- Tool-ի արդյունքը success չէ, մինչ չստուգվի. agent-ը գրանցում է հայտարարված evidence-ը։
- Եթե run-ը պահանջում է approval boundary-ից դուրս գործողություն, այն անցնում է **Waiting approval** և դադարում — երբեք չի շրջանցում gate-ը։
- Agent-ը կարող է report անել միայն՝ completed-with-evidence, partially-completed-with-evidence, blocked-with-reason, failed-with-reason կամ not-started։ Անորոշ progress-ն անվավեր է։

Ազնիվ ավարտի դեպքում agent-ը կցում է evidence և task-ը տանում **review** (agent execution՝ `completed`)։ Ձախողված run-ը task-ը տանում է **blocked**՝ պատճառով, ոչ done։

### 6.4 Review → done gate
Մարդ reviewer-ը (default՝ project owner) բացում է review-ը՝ completion criteria-ն ցուցադրվում է կցված evidence-ի կողքին։ Reviewer-ը՝
- **Approve** → task **done**. տալիս `task.completed`։
- **Request changes** → **active** (մարդ) կամ վերա-delegate (agent)՝ review notes-ով։
- **Reject** → **blocked** կամ **cancelled**՝ պատճառով։

Done-ն անհնար է առանց այս gate-ի։ Bro-ն task-ը ավարտված է հայտարարում միայն, երբ և՛ execution evidence-ը, և՛ verification-ը կան։

Վիճակներ ըստ հոսքի՝ **loading** (agent-ի կապ / evidence render skeleton). **empty** (evidence դեռ չկա — review-ը անջատված «awaiting evidence»-ով). **error** (agent/tool ձախողումը ցուցադրվում է verbatim, task → blocked, retry/reassign). **offline** (run չի սկսվում. հերթ. ընթացիկ run-ի վերջին known state-ը՝ stale). **permission-denied** (user-ը չի կարող delegate անել կամ review անել — գործողությունը տեսանելի է, բայց անջատված՝ պատճառով. STATES.md §6). **blocked** (blocker reason պարտադիր, unblock owner առաջարկվում է). **awaiting-approval** (run-ը դադարած approval chip-ի վրա. DECISION_APPROVAL_FLOWS.md-ում լուծելը վերսկսում կամ չեղարկում է run-ը)։

## 7. Նախագծի փակման հոսք

Փակումը gated է, ոչ երբեք մեկ կոճակ, որ պարզապես archive անի։

**Քայլ 1 — Completion-criteria review.** Ստեղծման ամեն success criterion ցուցադրվում է met/unmet վիճակով և այն evidence-ով, որ բավարարում է։ Չբավարարված criteria-ն փակում է մաքուր close-ը։

**Քայլ 2 — Unresolved-risk review.** Բաց blocker-ները, ոչ-terminal task-երը, չլուծված decision-ները և բաց approval-ները թվարկվում են։ Ամեն մեկի համար owner-ը պետք է **լուծի**, **բացահայտ ընդունի որպես residual risk** (գրանցվում է) կամ **փոխանցի** այլ նախագծի։

**Քայլ 3 — Close որոշում.** Owner-ն ընտրում է՝
- **Close as completed** — թույլատրված միայն, երբ criteria-ն բավարարված են (կամ residual ռիսկերը բացահայտ ընդունված)։ Տալիս `project.closed`, snapshot է անում evidence-ը, նախագիծը դառնում read-only Completed։
- **Close as cancelled** — պահանջում է պատճառ. dependent-ներն ու կապված agent-ները ազատվում և ծանուցվում են։
- **Archive** — շրջելի. թաքցնում է active list-երից, ամեն ինչ պահում անփոփոխ։

Փակումը ազատում է agent binding-ները և կանգնեցնում նախագծի recurring task-երը։

Վիճակներ ըստ հոսքի՝ **loading** (criteria/risk aggregation skeleton). **empty** (criteria չկա — close-ը փակ է, մինչ criteria լինի կամ պատճառով waive արվի). **error** (aggregation ձախողվեց — չթույլատրել close թերի տվյալի վրա). **offline** (close հետաձգվում. preview թույլ, commit հերթ). **permission-denied** (միայն owner/authorized role-ը կարող է close անել). **blocked** (չբավարարված criteria կամ բաց A3 approval-ը կոշտ փակում է completed-close-ը). **awaiting-approval** (եթե close-ն ինքը պաշտպանված գործողություն է, մտնում է approval հերթ)։

## 8. Գլոբալ վիճակների պայմանագիր

Վերևի ամեն հոսք պետք է ազնվորեն ցուցադրի հետևյալ յոթ վիճակը — [STATES.md](STATES.md)-ի տասը կանոնական վիճակից յոթը (այնտեղ սահմանված են նաև `populated`, `destructive-confirmation`, `success`). ոչ մեկը չի կարող թաքցնել կատարումը, approval-ը, ownership-ը, ձախողումը կամ անորոշությունը (Գլոբալ կանոն, USER_FLOWS.md)՝

- **loading** — skeleton, ոչ դատարկ. shell-ը interactive և cancelable։
- **empty** — նպատակային first-run ուղղորդում primary CTA-ով, երբեք փակուղի։
- **error** — ճշգրիտ, verbatim երբ անվտանգ է. պահել user input-ը. առաջարկել retry. երբեք չհորինել success։
- **offline** — վերջին sync snapshot՝ staleness badge-ով. գրառումները հերթ և idempotent replay։
- **permission-denied** — read-only, կամ տեսանելի բայց անջատված ըստ role-ի (STATES.md §6՝ մերժված գործողությունը երբեք չի թաքցվում), request-access ուղիով. երբեք լուռ ձախողում։
- **blocked** — տեսանելի պատճառ և, հնարավոր դեպքում, unblock owner ու ուղի։
- **awaiting-approval** — pending գործողությունը, նրա scope-ը, impact-ը և expiry-ն ցուցադրվում են. կատարումը պահվում է, մինչ approval-ի լուծումը։

> **Չհամաձայնեցված (2026-10-14)․** «վերևի ամեն հոսք պետք է ցուցադրի հետևյալ յոթը»-ն §2-ի համար ճիշտ չի։ Նախագծի ստեղծման հոսքի վիճակները վեցն են՝ loading, empty, error, offline, permission-denied, awaiting-approval, առանց **blocked**-ի. §3–§7-ից ամեն մեկը թվարկում ա յոթն էլ։ Կամ §2-ին պակասում ա blocked վիճակ, կամ նախադասությունը նշանակում ա «ամեն մեկը որտեղ կիրառելի ա»՝ էն ձևակերպումը, որ [SCREEN_INVENTORY.md](SCREEN_INVENTORY.md)-ն ու [INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md) §1.3-ը օգտագործում են կանոնական հավաքածուի համար։ Թե որը՝ որոշված չի։ Կոդը չի լուծում՝ §2-ի ստեղծման հոսքը կառուցված չի. project-ը ստեղծվում ա անունից, նկարագրությունից ու priority-ից (`createProject`՝ `src/features/Projects.tsx`-ում), առանց template-ի, objective-ի ֆորմի կամ proposal card-ի։
