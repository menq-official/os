- **Purpose:** Describe the primary end-to-end user flows through BroPS.
- **Scope:** Command-to-outcome, group collaboration, project execution, approval, memory/knowledge, and the global flow rule. Trilingual product surface (HY/EN/RU).
- **Owner:** Gev.
- **Related:** [NAVIGATION.md](NAVIGATION.md), [SCREEN_INVENTORY.md](SCREEN_INVENTORY.md), [WORKSPACES.md](WORKSPACES.md), [GROUP_CHAT.md](GROUP_CHAT.md), [SEARCH_AND_COMMAND_PALETTE.md](SEARCH_AND_COMMAND_PALETTE.md), [../architecture/ARCHITECTURE.md](../architecture/ARCHITECTURE.md), [../architecture/DESIGN_SYSTEM.md](../architecture/DESIGN_SYSTEM.md).
- **Last updated:** 2026-10-14. *(This line said 2026-07-19 while the file was changed on 2026-10-02.)*

# BroPS User Flows / Օգտագործողի հոսքեր

Status: Draft canonical

## 1. Command to Outcome / Հրամանից արդյունք

1. Gev enters a command.
2. Bro classifies intent, risk, required context, tools, and agents.
3. Bro asks only for truly missing owner decisions.
4. Low-risk work runs automatically.
5. High-impact work creates an approval request.
6. Output is attached to its project, task, decision, files, and activity record.

## 2. Group Chat Collaboration / Խմբային համագործակցություն

1. User opens or creates a room.
2. Humans and agents are invited.
3. Messages can mention people, agents, projects, tasks, files, or decisions.
4. Bro routes requests and prevents duplicate work.
5. Important statements can become tasks, decisions, approvals, knowledge, or memory.
6. Room summary and unresolved items remain visible.

## 3. Project Execution / Նախագծի կատարում

1. Create project from template or blank state.
2. Define objective, constraints, owner, deadline, and success criteria.
3. Bro proposes plan and agent assignments.
4. Tasks move through planned, active, blocked, review, done, or cancelled states.
5. Evidence and decisions remain connected to the project.
6. Project closes only after completion criteria and unresolved-risk review.

## 4. Approval / Հաստատում

1. A protected action is prepared, never silently executed.
2. User sees action, target, reason, effects, rollback, and evidence.
3. User approves, rejects, or requests changes.
4. Approval is bound to the exact action scope and expires after material change.
5. Execution result is recorded.

## 5. Memory and Knowledge / Հիշողություն և գիտելիք

1. Conversation or work produces a candidate fact.
2. Bro classifies it as transient context, memory candidate, knowledge candidate, or decision evidence.
3. Persistent storage requires provenance and scope.
4. User can inspect, correct, archive, or delete persistent records.
   > **Not reconciled (2026-10-14):** the "Rules" of the Memory engine in [../architecture/AI_RUNTIME.md](../architecture/AI_RUNTIME.md) give a memory four operations — corrected, superseded, expired, deleted. This step gives a persistent record (memory or knowledge) three, and one of them, archive, is a memory or knowledge operation in no other document under `docs/product/` or `docs/architecture/`. Whether archive is a fifth operation, this step's word for supersede and expire, or a slip has not been decided. The code does not settle it: neither store has an update, an archive, a supersede or an expiry (`src/services/desktop.ts` — memory has list, create, pin and delete; knowledge has list, search, create and delete), and both deletes refuse every call (`forbidden_hard_delete` in `src-tauri/src/commands.rs`). Today a record can be created and read, and a memory pinned.
   >
   > **Չհամաձայնեցված (2026-10-14)․** [../architecture/AI_RUNTIME.md](../architecture/AI_RUNTIME.md)-ի Memory engine-ի «Rules»-ը հիշողությանը չորս գործողություն ա տալիս՝ corrected, superseded, expired, deleted։ Այս քայլը մշտական գրառմանը (memory կամ knowledge) տալիս ա երեքը, ու դրանցից մեկը՝ archive-ը, `docs/product/`-ի ու `docs/architecture/`-ի ոչ մի ուրիշ փաստաթղթում memory-ի կամ knowledge-ի գործողություն չի։ Archive-ը հինգերո՞րդ գործողություն ա, այս քայլի բա՞ռն ա supersede-ի ու expire-ի համար, թե՞ վրիպակ՝ որոշված չի։ Կոդը չի լուծում՝ երկու պահեստից ոչ մեկը update, archive, supersede կամ expiry չունի (`src/services/desktop.ts`՝ memory-ն ունի list, create, pin ու delete, knowledge-ը՝ list, search, create ու delete), ու երկու delete-ն էլ մերժում են ամեն կանչ (`forbidden_hard_delete`՝ `src-tauri/src/commands.rs`-ում)։ Այսօր գրառումը կարելի ա ստեղծել ու կարդալ, իսկ memory-ն՝ նաև pin անել։

## Global Rule / Համընդհանուր կանոն

No flow may hide execution state, approval state, ownership, failure, or uncertainty.

Ոչ մի հոսք չի կարող թաքցնել կատարման վիճակը, հաստատման վիճակը, սեփականությունը (ով է պատասխանատուն), ձախողումը կամ անորոշությունը։
