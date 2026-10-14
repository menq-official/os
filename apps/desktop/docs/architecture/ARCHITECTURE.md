# BroPS Product Architecture

- **Purpose:** Describe the system structure of BroPS — domains, entities, execution model, and state separation.
- **Scope:** Product architecture only. The AI runtime is in [AI_RUNTIME.md](AI_RUNTIME.md); UX surfaces are in [product/](../product/).
- **Owner:** Gev.
- **Related:** [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md), [AI_RUNTIME.md](AI_RUNTIME.md), [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), [product/NAVIGATION.md](../product/NAVIGATION.md).
- **Last updated:** 2026-10-14. *(This line said 2026-07-19 while the file was changed on 2026-08-08 and 2026-10-02.)*

## Core domains

1. Identity and access
2. Conversation and rooms
3. Projects and workspaces
4. Tasks and execution
5. Agents and teams
6. Knowledge and retrieval
7. Memory and preferences
8. Decisions and approvals
9. Files and sources
10. Calendar and scheduling
11. Automations and triggers
12. Integrations and external actions
13. Activity, audit, analytics, and security

## Primary entities

- User
- Agent
- AgentTeam
- Room
- Message
- Thread
- Project
- Task
- Decision
- Approval
- KnowledgeItem
- MemoryItem
- FileAsset
- Automation
- Integration
- ActivityEvent
- EvidenceRecord

These entities define the conceptual data model. The concrete persisted schema exists: the entities and enums are in [DATA_MODEL.md](DATA_MODEL.md), the table contract in [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md), and the schema itself is the ordered migrations under `src-tauri/core/schema/`, which are the authority when a document disagrees with them.

## Execution model

1. Gev states intent.
2. Bro resolves objective, scope, risk, and context.
3. Bro proposes or creates an execution plan.
4. Work is delegated to specialist agents.
5. Approval gates stop actions requiring authority.
6. Agents execute within explicit scope.
7. Results include evidence and status.
8. Bro synthesizes and reports the final state.
9. Canonical project records are updated when required.

The mechanics of steps 2–8 (orchestrator modes, agent contracts, engines, events, tool execution, and the approval model) are canonical in [AI_RUNTIME.md](AI_RUNTIME.md).

## State separation

- Conversation state: temporary dialogue context
- Workspace state: current project and task state
- Canonical state: approved repository or database records
- Evidence state: logs, diffs, checks, outputs, and receipts
- Memory state: durable user and system context

## Product boundary

The first build is a product prototype and application foundation. Debian deployment, local models, background services, and infrastructure are later concerns and must not distort the initial product model.

*(Read against the code 2026-10-14.)* "The first build" is the prototype this paragraph was written for. Three of the four things it calls later concerns have since been built in this tree: a Debian package (`bundle.linux.deb` in `src-tauri/tauri.conf.json` names `deb/postinst` as its post-install script, and the repository-root `docs/DEBIAN_DEPLOYMENT.md` describes the deployment), a local model (`Provider::Ollama`, one of the providers `resolve_provider` returns in `src-tauri/src/ai.rs`), and a background service (the broker, a separate binary crate under `src-tauri/broker`). The rule in the second half of the sentence — they must not distort the product model — is a design rule and stands as written.

---

# Ճարտարապետություն

BroPS-ը կառուցվում է առանձին domain-ներով, բայց օգտագործողի համար գործում է որպես մեկ միասնական AI Operating System։ Conversation-ը, canonical state-ը, evidence-ը և memory-ն տարբեր շերտեր են և չեն կարող խառնվել։ AI runtime-ի մեխանիկան canonical է [AI_RUNTIME.md](AI_RUNTIME.md)-ում, իսկ UI մակերեսները՝ [product/](../product/)-ում։ Կոնկրետ տվյալների սխեման արդեն կա՝ entity-ները ու enum-ները [DATA_MODEL.md](DATA_MODEL.md)-ում են, աղյուսակների contract-ը՝ [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)-ում, իսկ բուն սխեման `src-tauri/core/schema/`-ի migration-ներն են, որոնք էլ աղբյուրն են, երբ փաստաթուղթը չի համընկնում։

*(Կոդի դեմ կարդացված 2026-10-14։)* Անգլերեն կեսի «Product boundary» պարբերությունը ասում ա, որ Debian deployment-ը, local model-ները, background service-ները ու infrastructure-ը «հետոյի հարցեր են»։ Դա գրվել ա առաջին prototype-ի համար։ Չորսից երեքը այս ծառում արդեն կառուցված են՝ Debian package (`src-tauri/tauri.conf.json`-ի `bundle.linux.deb`-ը `deb/postinst`-ը նշում ա որպես post-install script, deployment-ը նկարագրված ա repo-ի արմատի `docs/DEBIAN_DEPLOYMENT.md`-ում), local model (`Provider::Ollama`՝ `src-tauri/src/ai.rs`-ում), ու background service (broker-ը՝ առանձին binary crate `src-tauri/broker`-ում)։ Նախադասության երկրորդ կեսի կանոնը՝ որ դրանք չպիտի աղավաղեն product model-ը, design-ի կանոն ա ու մնում ա ինչպես գրված ա։
