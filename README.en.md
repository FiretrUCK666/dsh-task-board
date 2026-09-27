# dsh-task-board

[中文](README.md) | English

[![npm](https://img.shields.io/npm/v/@firetruck666/dsh-task-board)](https://www.npmjs.com/package/@firetruck666/dsh-task-board)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%5E22.19.0%20%7C%7C%20%3E%3D24.0.0-339933)](README.en.md#requirements)

A task-board plugin for the DeepSeek Harness web GUI. It adds a **Task Board** entry in the sidebar and manages work on a five-column kanban board, where each task is actually executed by a real DSH session and its status is written back to the card.

The plugin does not modify DSH source, and removing it restores the interface. Board data lives on the DSH host process, so a desktop and a phone pointed at the same deployment see the same board, synchronised over SSE. Narrow screens switch to a compact layout.

The Chinese [README.md](README.md) is the source of truth; this file mirrors it.

## 目录

<!-- toc:start -->

- [Requirements](#requirements)
- [Install](#install)
- [What it does](#what-it-does)
- [Data locations](#data-locations)
- [Updating](#updating)
- [Building from source](#building-from-source)
- [Contributing](#contributing)
- [Troubleshooting](#troubleshooting)
- [Naming](#naming)
- [License](#license)

<!-- toc:end -->

## Requirements

- DeepSeek Harness `0.1.7-rc.2` or later. `0.1.7-rc.2` is the **verified minimum**, which is what this plugin currently runs on. Later releases are tracked but not individually tested, so they are not guaranteed. If loading fails, follow the Troubleshooting section.
- Node.js `^22.19.0` or `>= 24.0.0`
- pnpm 10 or newer
- The DSH `web` profile

This plugin runs in the web GUI only.

## Install

Pick one. All three commands run in your own terminal.

### From npm

```sh
dsh plugin --profile web add @firetruck666/dsh-task-board
```

Installs the most recent release. This is the right choice for everyday use.

### From GitHub

```sh
dsh plugin --profile web add github:FiretrUCK666/dsh-task-board
```

Installs the current `main` branch. Like the npm install this is a ready-to-use package, not a development environment: it has no tests and no build tooling, so the code cannot be changed in place. Use it to pick up unreleased changes early; stability depends on the state of the branch at that moment.

### From a local checkout

In the repository directory:

```sh
pnpm install
pnpm build
dsh plugin --profile web add .
```

This is the path for changing the code. See "Building from source" below.

A local install links to your working directory rather than copying it, so one install is enough: after changing code, just run `pnpm build` and restart `dsh web` — do not re-run the install command above. Client-half changes need only a page refresh; host-half changes need the restart. See "A code change had no effect" under Troubleshooting.

The first two are installs: each delivers a ready-to-use package containing only the files in the publish list (runtime code, source, the bundle patch, documentation). The third is development: a full checkout you can edit and test.

| | npm | GitHub | Local |
| --- | --- | --- | --- |
| Purpose | install and use | install and use | development |
| You get | latest release | current `main` | your working tree |
| Version | stable | newest, may be less stable | whatever you have |
| Update source | npm version | latest commit | not applicable |

An npm install and a GitHub install contain essentially the same files; they differ in how new the code is. Install from GitHub to pick up unreleased changes, from npm for a stable release.

### After installing

Stop the running `dsh web` and start it again. Refreshing the page is not enough: the host half of the plugin loads inside the server process. The **Task Board** entry appears in the sidebar after the restart.

The entry sits beside DSH's own Plugins panel. Selecting it puts the board in the centre stage; selecting the entry again — or any session in the sidebar — brings the conversation back.

The plugin has **exactly one switch: on or off.** It appears in two places and they do the same thing — the toggle on the plugin's row under **sidebar → Plugins → Installed**, and the one at the top right of the plugin's own page (click the plugin name). **Off means the plugin is not loaded** (sidebar entry, board and background routes all stop); **on restores it.**

### Nothing to configure by hand

It works once installed — no config file to edit, no declaration to write. And **do not add anything to `cordis.patch.yml` yourself**: the plugin's row lives inside the package, and the install command only registers that package in the profile; the two together are the whole setup. Hand-adding a row makes the same plugin appear twice.

| Step | Who does it |
| --- | --- |
| Register the plugin in the local profile | The install command (adds a package name to `dsh.profile.bundles`) |
| The plugin's row (id, package name) | `cordis.patch.yml` inside the package, pointed at by `dsh.bundle.patch` in `package.json`; applies at composition |
| UI entry, board stage | The plugin registers them into DSH's official extension points at startup |
| Where data lives | `~/.dsh/storages/dsh_task_board/`, created on first run |
| Display name, description, icon | `locale/` and `icon.svg` in the package, read directly by DSH |
| Where that switch lives | The plugin manager writes `disabled` on this row (and only when you switch it off) |

The one step you must take is **restarting `dsh web`** (the host half lives in the server process and is not loaded otherwise). All three install routes — npm, GitHub, local — behave identically here.

This plugin has no settings and needs no settings panel: the board's behavior (tasks, schedules, cruise, rules) is edited directly on the board, and on/off is the switch above.

To remove it:

```sh
dsh plugin --profile web remove @firetruck666/dsh-task-board
```

A restart is required here too. Your task data is not deleted.

## What it does

- **Five columns** — To plan, To do, In progress, Needs review, Done. Cards carry a summary only; the execution window and the comment timeline live in the detail view. Every session that finishes lands in Needs review. A card floats to the top of the column it lands in, newest arrival first, so the one that just finished is obvious at a glance; a position you dragged by hand is never pushed aside, and only re-sorts when that card changes column again.
- **Card from sessions** — The header's "Card from Sessions" button takes a pick of existing sessions (any number, across workspaces) and creates one new task card carrying them, in the To plan column, with title, description, prompt and run configuration all left blank for you to fill. The task detail's "Add Session" and this button share ONE picker: grouped by workspace, collapsed by default, listing only sessions that are unarchived and addable right now.
- **Session order** — A card's session list follows the same law as its columns: a conversation that starts working, or that just finished, floats to the top of the list while the others keep their relative order and step down. An order you dragged by hand is never shuffled apart, only displaced.
- **One set of status words** — Many places on the board say "what state is this card in". They all read one derivation, so the same card gives the same answer everywhere:
  - **Awaiting your decision** (reads *Failed · awaiting your decision* when the work failed) — the card is in Needs review, has finished work, and you have not opened **that session** yet. It clears when you open that session, or approve / send it back.
  - **N need you** (the header line) — N conversations are suspended on your answer (approval, plan review, question). It clears as you answer them.
  - **M in review** (the header line) — M cards are in Needs review with that session still unopened. Same clearing as the chip.
  - **New N / New comment** — this card has content you have not read. It clears on opening the card.
  - **N runs** — how many times the card has run. That is history, not a request, so it never clears on its own.
  - **The board reads in two layers, on purpose: a card is a summary, a session is the content.** So opening the *card* retires its New badge and its pulse (you have seen the summary) but leaves Awaiting your decision and the notification alone — you still have not read the conversation. Opening *that session* clears both. Or just approve / send it back.
  - The notification centre holds exactly two kinds, and the three filter chips each carry their own count: **Need you** (a conversation suspended on your answer) + **In review** (finished, session unopened) = **All**. The bell badge, the header's two halves and the drawer's three chips are one classification rendered four times, so they always agree.
  - A **cancelled** run is not a decision, so it never asks for one; it only appears in the comment thread and the activity feed.
- **Real execution** — Pressing Run starts a real DSH session, visible in the native session list. An execution prompt that begins with `/` runs as a native command, so `/plan ...` enters plan mode for real.
- **Multi-device sync** — The board's source of truth is the host, stored under `~/.dsh/storages/dsh_task_board/`. The browser is an optimistic copy: the board opens instantly, works while offline, and catches up afterwards. Concurrent edits merge per record and do not depend on device clocks.
- **One engine at a time** — Scheduled runs, cruise and follow-ups are arbitrated by a host lease, so only one open GUI executes them. The device in the foreground holds the engine seat and takes over when it becomes visible.
- **Comments and conversation** — Each session row opens a panel with the live transcript on one side and usage, run configuration, the comment thread and the composer on the other. Messages queue by default or can be steered immediately. `@` mentions and `/` commands use the same mechanisms as the main composer. Images are compressed in the browser; other files upload byte for byte.
- **Attachments are content** — Send an image or a file with no words at all; the message is not required to carry text. Images are compressed in the browser, other files upload as their exact bytes. If a send is ever refused, the composer says so and keeps your draft instead of quietly handing the content back.
- **Answer the agent right there** — When a session is waiting on you (a plan to confirm, an `ask_user_question`), the interaction card appears in the comment thread with the SAME parts and behaviour as the native question card: options, a custom answer, previous/next, skip, submit or approve/decline/discuss. Answering settles the request on the spot and the model continues; "Answer in session" and "View session" still take you to the full conversation. The to-do, goal and subagent readout in the same area comes from the native panel.
- **Automation** — Task-level cron schedules and follow-on-completion chains; session-level rules that inject either a custom instruction or the task's execution prompt, on a timetable or after every completion.
- **Auto-cruise** — Batch-execute every ready task from the board header, with a global concurrency cap and time windows.
- **Parallelism counted per session** — The header's parallelism number is the single gate: it caps how many sessions run at once. Sessions on one card do not block each other; within one session, work stays ordered.
- **Mobile and narrow screens** — The layout responds to the board's own width, not the viewport, and shares one code path with the desktop. Columns scroll horizontally with an evenly divided tab strip; the header keeps every control labelled and reflows deterministically.
- **Drag and drop** — Reorder within a column, move between columns, auto-scroll at the edges, and drag sessions or workspaces in from the sidebar. Dragging is mouse/trackpad only: it uses the browser's built-in drag-and-drop, which touch screens do not raise. Dragging a session in from the sidebar is likewise host-driven and not available on a phone; on a touch screen, move a card with the `[` and `]` keys on a keyboard, or from the card detail's Status section.
- **Templates and run presets** — Save a task as a template; store run configurations (agent, workspace, model, reasoning effort, permissions) as presets and set one as the default, with a fallback to the deployment default.
- **Notifications and activity** — An inbox aggregating sessions waiting on you plus unread tasks with review pending, and a board-wide activity feed grouped by day.
- **A task list in the right sidebar** — A second document, not a view over the board. It lives in DSH's own right sidebar because that sidebar is present in every session: the list is for the thought that arrives while you are already talking to the model, and it needs no click on the board first. Two entries, both in DSH's chrome: the Open-list button in a session header, and the list entry on the right sidebar's guide page. They open the same panel. The list and the board coexist — an item does not have to become a card, and when it hangs off one it reads that card's live state rather than judging it for itself. Each item carries a title, Markdown body, notes, one-level steps, a status, four priority tiers, tags, and three INDEPENDENT times: earliest start, due, and hard deadline. Progress is derived, so an item with no steps shows no progress bar at all. Every item has a short number (`#12`) that both people and models say out loud; it is minted by a counter on the document and is never writable, so a replica cannot renumber the list under you. Creating, editing and deleting all work by hand in the panel, and deleting goes through a tombstone — items are recoverable, unlike cards. The panel's read state is three-valued, not a boolean: quiet while loading, syncing with the host, and "cannot reach the host copy right now, showing this device's copy" — that last one must never be rendered as "you have nothing", because turning "cannot read" into "there is none" is a lie about the system's state. The list needs DSH's right sidebar: on a host without it the panel simply does not exist, and the board is unaffected.
- **Two slash commands** — Both act in the session you are already talking in. `/task <what you want written down>` hands that one sentence to the current session's model, which can already see this conversation's whole context, so "write down the three things we just discussed" needs nothing relayed. `/task-continue` asks the model to read the outstanding items, list them, and then ask which one to start with rather than picking for you. `/task` works whenever you like in a conversation, early or late, and the model reads the context as it stands at that moment. How many items to write, whether to amend an old one, whether to open a board card — that is the model's own judgement; this plugin fixes no workflow, because a fixed workflow here would be a second set of rules to keep in step with the board. The command is a door: it takes your words, hands them over, and says nothing else.
- **What the agent can do** — It looks the capability list up on demand instead of carrying it in its prompt, so the list can never go stale; the fixed text in the system prompt is behaviour, not inventory, because a capability list copied into a prompt is a second copy of the catalog and a stale one is worse than none. What the agent does and what you do in the interface are the SAME implementation, so the same thing cannot produce two results. A batch runs in order, stops at the first failure, rolls back nothing, and reports item by item. Actions the interface locks down are locked down for the agent too, and it will say why rather than refusing vaguely — marking a card read is the clearest case, because it clears the very gate that is waiting on you, so an agent doing it would close your own gate on your behalf. Attachments are the other boundary: there is no upload channel on the model side, and an invented reference to a file is content that cannot be drawn.

## Data locations

- Board source of truth: the `~/.dsh/storages/dsh_task_board/` directory. Under `documents/` there is one file per data kind: `board.json` holds the task ledger, cruise, schedule presets, run presets and deletion tombstones, and `items.json` holds the task list. Human-readable, written atomically; back the directory up directly, or delete it to clear both board and list.
- Browser `localStorage` holds the offline mirror: `dsh.taskBoard.v1`, `dsh.taskBoard.cruise.v1`, `dsh.taskBoard.presets.v1`, `dsh.taskBoard.runPresets.v1`. Drafts in `dsh.taskBoard.drafts.v1` are device-local and deliberately not synchronised.
- On the first connection, diverging local data is backed up to `dsh.taskBoard.preSync.v1` and the host wins.
- Without a storage backend on the host, the board falls back to a pure `localStorage` mode.

## Updating

Easiest: the board header's right toolbar has a permanent Check for updates button. One click compares the running version against the latest; when an update exists it shows the matching update command for your install method — copy it and run it in your own terminal.

With the plugin marketplace installed, press Update on the Installed tab. Otherwise re-run an install command:

```sh
dsh plugin --profile web add @firetruck666/dsh-task-board@latest
```

Or, if you installed from the GitHub source, point the same command at the repository — the latest commit on the default branch is what gets installed:

```sh
dsh plugin --profile web add github:FiretrUCK666/dsh-task-board
```

Restart `dsh web` afterwards.

## Building from source

Requires Node.js 22 or 24, pnpm, and access to the public npm registry. Types and runtime APIs come from `@deepseek-ai/*`; no DSH source checkout is needed.

```sh
git clone https://github.com/FiretrUCK666/dsh-task-board.git
cd dsh-task-board
pnpm install
pnpm build       # emits lib/index.js and lib/client.js
pnpm typecheck
pnpm test
pnpm verify
```

`lib/` is a build artifact, but it is committed. Installing from GitHub or npm only copies files and never runs a build, so a repository without `lib/` would install a plugin that cannot start. Rebuild after changing source and commit `lib/` together with that change; CI checks that the two agree.

`AGENTS.md` in the repository root records the project conventions, the architecture index and the release process; it is the reference AI assistants work from in this repository.

## Contributing

Issues and pull requests are welcome. Before you start, read [CONTRIBUTING.md](CONTRIBUTING.md): development setup, the pre-PR checklist and the hard rules. Load-failure reports should include three things: your DSH version, the plugin version and the error text.

## Troubleshooting

**No sidebar entry after installing.** The host half loads in the server process. Restart `dsh web`; refreshing the page is not enough.

**Upgrading from an older version: the entry and the settings moved.** The board now attaches through DSH's official UI extension points (which is what lets it keep working across interface changes): the entry went from a row at the bottom of the sidebar to a panel icon beside DSH's own Plugins panel, and the plugin's settings went from Settings → Task Board to the plugin's own page (sidebar → Plugins → Installed → Task Board), where the switch now sits together with the plugin itself. Nothing was removed and no task data changed. If you still see the old locations, this client is running an older front-end bundle — refresh the page.

**The plugin fails to load after a DeepSeek Harness upgrade (the page says "Failed to load plugins").** DSH's internal interfaces change between releases, and the plugin has to follow. Two steps:

1. Update the plugin to the latest release, then restart `dsh web`:

   ```sh
   dsh plugin --profile web add @firetruck666/dsh-task-board@latest
   ```

2. If it still fails, the plugin has not caught up with your DSH version yet. Please open an [issue](https://github.com/FiretrUCK666/dsh-task-board/issues) with three things: your DeepSeek Harness version, the plugin version (shown in Settings, installed plugins), and the exact error text from the page. Those three are enough to locate the cause.

**The board opens, but devices do not sync and the task list stays empty.** That is what a host half which failed to load looks like, and it is the easiest failure to miss after a DSH upgrade: the board still works on the page, but its data stays in that one browser, so another device is not looking at the same board and schedules and cruise never actually fire. In this state the task list says "cannot reach the host copy right now, showing this device's copy" rather than pretending you have nothing. Fix it the same way as the entry above — update the plugin, then restart `dsh web`.

**The board changed shape after opening the right sidebar.** That is the responsive layout working, not a fault. DSH's right sidebar takes about 45% of the viewport with a 300px floor, and the centre column keeps 400px, so opening it makes **the board's own box narrower**. The board responds to the width of its own box rather than the window, so once the box crosses the compact threshold the five columns become a horizontally scrolling track with an evenly divided tab strip. Closing the sidebar restores it.

**A code change had no effect.** Changes under `src/index.ts` or `src/host/` need a `dsh web` restart; client-side changes only need a page refresh. Run `pnpm build` first in both cases.

**Scheduled work runs twice with two devices open.** It should not: scheduling, cruise and follow-ups are arbitrated by a host lease. If the header shows a stale-server notice, open it to see the start time of the server process you are connected to; an old timestamp means a different, un-restarted instance is serving that address.

**Moving to another machine.** Copy the `~/.dsh/storages/dsh_task_board/` directory. The browser `localStorage` is only a mirror.

**No entry for the task list.** Two things hide it: a host build without the right sidebar, or a page still serving an older bundle (the list lives in DSH's right sidebar, on the button in a session header). The second is fixed by refreshing. Neither affects the board — the list's entry is optional, and a host that does not offer it gets no registration at all, so the panel does not exist rather than half existing.

**`dsh plugin` cannot find pnpm.** Install pnpm (`npm install -g pnpm`) and re-run.

## Naming

| Purpose | Value |
| --- | --- |
| Plugin id | `dsh-task-board` |
| npm package | `@firetruck666/dsh-task-board` |
| Permission preset route | `/api/dsh-task-board/permissions` |
| Board data route | `/api/dsh-task-board/board` (`/items`, `/lease`, `/command`, `/events`) |
| Other host routes | `/api/dsh-task-board/session-state`, `/update`, `/client-report` |
| Host storage unit | `dsh_task_board` (one file per data kind under `documents/`) |
| Board stage slot | `main` (`key: dsh-task-board`) |
| Sidebar entry slot | `sidebar.panellist` (`id: dsh-task-board`) |
| Task list slots | `sidebar.right.pane.tab`, `conversation.session.header.actions` |
| `localStorage` keys | `dsh.taskBoard.v1` and friends |

The plugin id and the package name are different things. The id names the loader row, the served browser asset, the routes, the storage unit and the extension points above; the package name is only what pnpm installed. A scoped package name never moves the id.

The plugin has no settings of its own, so there is no settings route and no settings page: the switch in the plugin marketplace writes `disabled` on the profile row, and the plugin declares no setting fields.

This plugin has no settings, so it has no settings panel either: the switch in the plugin manager writes the profile row's `disabled` (and only when you turn it off), and the plugin itself declares no setting fields.

## License

MIT. See [LICENSE](LICENSE).
