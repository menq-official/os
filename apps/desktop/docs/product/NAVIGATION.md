- **Purpose:** Define the user-facing sidebar and navigation projection of the BroPS system.
- **Scope:** Primary navigation groups, Home, Chat, project workspace, and task views. Trilingual product surface (HY/EN/RU).
- **Owner:** Gev.
- **Related:** [INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md), [SCREEN_INVENTORY.md](SCREEN_INVENTORY.md), [WORKSPACES.md](WORKSPACES.md), [GROUP_CHAT.md](GROUP_CHAT.md), [SEARCH_AND_COMMAND_PALETTE.md](SEARCH_AND_COMMAND_PALETTE.md), [USER_FLOWS.md](USER_FLOWS.md), [STATES.md](STATES.md), [../architecture/ARCHITECTURE.md](../architecture/ARCHITECTURE.md), [../architecture/DESIGN_SYSTEM.md](../architecture/DESIGN_SYSTEM.md).
- **Last updated:** 2026-10-14. *(This line said 2026-07-19 while the file was changed on 2026-10-02.)*

# BroPS Navigation

## Primary sidebar

This is the shipped sidebar, read off `NAV` in `src/app/nav.ts` — 23 items in four groups. The other documents that print a navigation list (INFORMATION_ARCHITECTURE §7, `architecture/UX_UI_SPEC.md`, the handoff's §2) defer to this one.

### Core
- Home
- Command
- Chat
- Group Chat
- Projects
- Tasks
- Agents

### Intelligence
- Knowledge
- Memory
- Decisions
- Bridge
- Research
- Library

### Operations
- Calendar
- Automations
- Approvals
- Activity
- Notifications

### System
- Files
- Integrations
- Analytics
- Security
- Settings

## Navigation law

The sidebar is not the product architecture. It is a user-facing projection of the system. Items may be pinned, collapsed, reordered, or hidden without changing the underlying domain model.

## Home

Home is the operational overview: priorities, active agents, approvals, blockers, upcoming events, system health, and a direct Bro command input.

## Chat

Chat contains:
- the room types defined under "Room types" in [GROUP_CHAT.md](GROUP_CHAT.md)
- Threads, mentions, files, decisions, tasks, summaries, and approvals

*(Until 2026-10-14 this list restated four of GROUP_CHAT.md's five room types as its own bullets — Direct Chat, Group Chat, Team Rooms, Project Rooms — and left out the Review room. Read against the code the same day: a stored conversation's kind is one of `direct`, `group` and `ask` (`CONVERSATION_KINDS` in `src-tauri/core/src/domain.rs`), so there is no team, project or review room in the store.)*

## Project workspace

Every project contains:
- Overview
- Group Chat
- Tasks
- Files
- Knowledge
- Decisions
- Agents
- Timeline
- Activity
- Settings

## Task views

- Inbox
- Today
- Assigned to me
- Assigned to agents
- Waiting approval
- Blocked
- Recurring
- Completed

---

# Նավիգացիա

Sidebar-ը բաժանվում է չորս հիմնական խմբի՝ Core, Intelligence, Operations և System։ Shipped sidebar-ը 23 item ունի (`src/app/nav.ts`)՝ Core-ում Home, Command, Chat, Group Chat, Projects, Tasks, Agents, իսկ Intelligence-ում Decisions-ից հետո՝ Bridge։ Յուրաքանչյուր project ունի իր Group Chat-ը, task-երը, file-երը, knowledge-ը, decision-ները, agent-ները և activity timeline-ը։
