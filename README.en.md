# dsh-task-board

[中文](README.md) | English

[![npm](https://img.shields.io/npm/v/@firetruck666/dsh-task-board)](https://www.npmjs.com/package/@firetruck666/dsh-task-board)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%5E22.19.0%20%7C%7C%20%3E%3D24.0.0-339933)](README.en.md#requirements)

A task-board plugin for the DeepSeek Harness web GUI. It adds a **Task Board** entry in the sidebar and manages work on a five-column kanban board, where each task is actually executed by a real DSH session and its status is written back to the card.

The plugin does not modify DSH source, and removing it restores the interface. Board data lives on the DSH host process, so a desktop and a phone pointed at the same deployment see the same board, synchronised over SSE. Narrow screens switch to a compact layout.

The Chinese [README.md](README.md) is the source of truth; this file mirrors it.

## Contents

<!-- toc:start -->

- [Requirements](#requirements)
- [Install](#install)
- [Updating](#updating)
- [What it does](#what-it-does)
- [Data locations](#data-locations)
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

## What it does

- **Board** — Five columns: To plan, To do, In progress, Needs review, Done. A card is a
  summary and a session is the content: opening the card retires its "New" badge, while
  "Awaiting your decision" only retires when you open *that session* or approve/send it
  back. Tasks run for real through DSH sessions and land in Needs review when they finish. A
  card floats to the top of the column it lands in, and a position you dragged by hand is
  never pushed aside.
- **Task list** — The second entry in the same sidebar panel list, right under the board:
  click it and the list takes the whole stage, click it again and you are back in the
  conversation. It fills the page, follows the sidebar collapsing to an icon rail, and adapts
  to a phone — the board's own seats, so it behaves like the board rather than
  re-deriving it. It is a **second document, not a view over the board**: an item does not
  have to become a card, and when it hangs off one it reads that card's live state. Each
  item has a short number (`#12`) minted by a counter and never writable, one-level steps,
  four priority tiers, tags, and three INDEPENDENT times.

  It has **pages**, and a page is a different question about your items — not a different
  way of drawing the same ones:

  | Page | Answers | On the rail |
  | --- | --- | --- |
  | **Inbox** | Just written down, given no structure yet. Give one a priority, a date, a tag or a card and it leaves this page by itself. | how many |
  | **List** | Every entry you have, as **one table**: tick / state / title / priority / due / tag. The head is sortable — tap a column name to order by it. | how many |
  | **Agenda** | The part that has a time, laid out by day. Anything whose earliest-start has not arrived is **not scheduled in** — it sits in a "not startable yet" fold that says why. | how many |

  **All three pages stay on the rail, and an empty one shows 0** — "asked, and the answer is
  zero" and "this question does not exist" are two different things. In the list table
  **state is a column** (**To do / In progress / Blocked / Done**), so a state is said once
  and in one place. Tag, stale, archive and
  filtered views are not destinations — you click into them and they open.
  The due column says different things in different weights: **Past due** is the one that
  turns red, "behind" and "is today" differ only in how dark the ink is, and only the
  **hard deadline** makes a row genuinely overdue — a date that slipped and a promise that
  was broken are two things, and the interface says so separately.
  **Missing a due date is only "behind schedule", and only the hard deadline turns a row
  red.** English has one word for "dead" and Chinese has three, so the distinction is made
  in the grammar instead: the three times read **from** (earliest start), **by** (due) and
  **hard by** (hard deadline). The hard deadline is the only one that may ever be called a
  deadline; a missed due date is behind schedule.

  **The list page is the only workbench**, because sorting, picking and batching only become
  questions past a few dozen rows. It opens with **three stat tiles** — **Behind / Blocked / No
  date** — each of which filters the list to that one thing; they answer 「what needs me now」,
  not 「how many states are there」. Below them a **filter bar** — state, date, tag. Priority is
  deliberately not among them: it answers 「set the focused row to this」 rather than 「show me
  these」, so it lives in the `⌘K` palette. Then the table itself.
  **Six orderings** (sequence / earliest start / due / hard deadline / priority / title) and
  **multi-select batching** (state, priority, date, ask AI, delete) live on this page — tick a few
  rows and the batch bar appears. **The inbox deliberately has no batching**: someone who just
  typed a line is still looking at the input, and batching answers a different question.

  **Row height is not a switch.** It is a fixed value, because it is a fact settled by touch
  targets and the type scale rather than a reader's preference. *Density* is the preference — and
  a switch that moves internal spacing but not row height is worse than none: the reader presses
  it, sees only the word 「compact」 said differently, and stops believing it.

  Deleting is a road with three steps: **delete** (one press and one undo, no confirmation
  dialog), **restore**, and **erase for good**. Deleting leaves a tombstone **carrying the row**,
  so an item is **recoverable for 30 days** — unlike cards. Erasing for good takes the *text*
  out and **leaves the stamp**, because that stamp is the only thing stopping a device that was
  asleep for a week from handing its stale copy back and putting the row on screen: without it
  "erase for good" would be "erase, and you can still undo it". The list page says the window in
  a line of its own and the entry beside it opens the archive drawer, where every row offers
  both restore and erase. The capture box
  takes inline
  syntax: `#tag`, `!1`–`!4` for priority, `@2026/12/24` for a full date (slashes — a
  dashed `@2026-12-24` is **not** a date here and stays in the text as words), and a leading
  `- [ ]` for a step. The parsed result shows as chips **as you type**, and a word that was
  recognised wrongly turns back into plain text when you click it. What the agent does and
  what you do are the same implementation — including ticking one step, turning an item
  into a board card, and restoring a deleted one.
- **Driving it from a conversation** — Two slash commands (`/task`, `/task-continue`) and
  three tools. The command hands **your own sentence** to the current session's model, which
  can already see the whole conversation, so "write down the three things we just
  discussed" needs nothing relayed. How many items to write, whether to amend one, whether
  to open a card — the model's own judgement; this plugin fixes no workflow. It looks the
  capability list up on demand instead of carrying it in its prompt, because a stale
  capability list is worse than none. A batch runs in
  order, stops at the first failure, rolls back nothing, reports item by item. Actions the
  interface locks down are locked down for the agent too, and it says why — marking a card
  read is the clearest case, because it clears the very gate waiting on you. There is no
  upload channel for attachments on the model side.
- **One-click hand-off** — An item that hangs off a card has a button that gives it to the
  model of the session that card runs in, and tells you which session that was. An item
  with no card has no button, because it has no target.
- **Multi-device sync** — The truth lives on the host under `~/.dsh/storages/dsh_task_board/`.
  The browser is an optimistic copy: it opens instantly, works offline, catches up after.
  Concurrent edits merge per record and do not depend on device clocks. Scheduled runs,
  cruise and follow-ups are arbitrated by a host lease, so **only one open GUI executes
  them**; the foreground device holds the engine seat and takes over when it becomes visible.
- **Automation** — Task-level cron schedules and follow-on-completion chains; session-level
  rules that inject either a custom instruction or the task's execution prompt, on a
  timetable or after every completion. Plus batch auto-cruise with a concurrency cap and
  time windows, and a parallelism number that caps how many sessions run at once.
- **Interface** — The layout responds to the board's own width, not the viewport, and shares
  one code path with the desktop. Drag and reorder within and between columns; drag sessions
  or workspaces in from the sidebar. Templates for tasks, run configurations saved as
  presets with a default. A notification centre aggregating what is waiting on you plus
  unread tasks, and a board-wide activity feed grouped by day. A cancelled run never asks
  for a decision — cancellation is an abort, and it only shows in the thread and the feed.

**What the words on a card mean.**
The five columns are **Backlog / To Do / In Progress / In Review / Done**. They all read
from **one derivation**, so the same card gives the same answer wherever you see it:

| The word you see | What it is saying | When it goes away |
| --- | --- | --- |
| **Waiting for you** (on failure: also *paused*) | The card is in **In Review** and there is a result from that **conversation** you have not looked at | Open that conversation's thread, or press Pass / Send back |
| **N waiting** | N conversations have a question parked for you (approval / plan confirm / a question) | You answer in that conversation |
| **M in review** | M cards sit in **In Review** with a conversation you have not seen | Same as the first row |
| **New** / **New comment** | This card has **new content** you have not opened | Opening the card clears it |
| **N to handle** | N conversations are waiting on you (shown when N > 1) | Answering them one by one |
| **N runs** | How many times this card has run — history, not a nudge | It never clears on its own |
| **Failed · paused** | An automation stopped after its last failure | Re-enable it in the detail |

**「Waiting for you」 and 「New」 are two different things.** *New* is 「this card you have not
opened」; *waiting for you* is 「that conversation you have neither opened nor decided on」.
**Cancelling is not 「waiting for you」** — cancellation is an abort, and it only ever shows in the
thread and the activity feed.

## Data locations

- Board source of truth: the `~/.dsh/storages/dsh_task_board/` directory. Under `documents/` there is one file per data kind: `board.json` holds the task ledger, cruise, schedule presets, run presets and deletion tombstones, and `items.json` holds the task list. Human-readable, written atomically; back the directory up directly, or delete it to clear both board and list.
- Browser `localStorage` holds the offline mirror. Two of them CARRY DATA and both need backing up: `dsh.taskBoard.v1` (the board) and `dsh.taskBoard.items.v1` (the task list) — **backing up one and losing the other is the same as losing the list**. The rest (`cruise` / `presets` / `runPresets` / `templates` / `drafts` / `preSync`) is this browser's own state or a one-time backup, not a second truth. **The key names are whatever `src/client/` actually writes**; this lists what is worth your worry, not every key.
- On the first connection, diverging local data is backed up to `dsh.taskBoard.preSync.v1` and the host wins.
- Without a storage backend on the host, the board falls back to a pure `localStorage` mode.

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

2. If it still fails, the plugin has not caught up with your DSH version yet. Please open an [issue](https://github.com/FiretrUCK666/dsh-task-board/issues) with three things: your DeepSeek Harness version, the plugin version (**on the plugin page's Installed list — not in Settings, this plugin has no settings**), and the exact error text from the page. Those three are enough to locate the cause.

**The board opens, but devices do not sync and the task list stays empty.** That is what a host half which failed to load looks like, and it is the easiest failure to miss after a DSH upgrade: the board still works on the page, but its data stays in that one browser, so another device is not looking at the same board and schedules and cruise never actually fire. In this state the task list says "cannot reach the host copy right now, showing this device's copy" rather than pretending you have nothing. Fix it the same way as the entry above — update the plugin, then restart `dsh web`.

**The board changed shape after opening the right sidebar.** That is the responsive layout working, not a fault. DSH's right sidebar takes about 45% of the viewport with a 300px floor, and the centre column keeps 400px, so opening it makes **the board's own box narrower**. The board responds to the width of its own box rather than the window, so once the box crosses the compact threshold the five columns become a horizontally scrolling track with an evenly divided tab strip. Closing the sidebar restores it.

**A code change had no effect.** Changes under `src/index.ts` or `src/host/` need a `dsh web` restart; client-side changes only need a page refresh. Run `pnpm build` first in both cases.

**Scheduled work runs twice with two devices open.** It should not: scheduling, cruise and follow-ups are arbitrated by a host lease. If the header shows a stale-server notice, open it to see the start time of the server process you are connected to; an old timestamp means a different, un-restarted instance is serving that address.

**Moving to another machine.** Copy the `~/.dsh/storages/dsh_task_board/` directory. The browser `localStorage` is only a mirror.

**No entry for the task list.** It is the **second row in the sidebar panel list, right under
"Task Board"** — widen the sidebar and you will see two icons; click the second one to open the list,
click it again to return to the conversation. With the sidebar collapsed to an icon rail the two sit
side by side.

If the row is **not there at all**: the page is probably still serving an older bundle, so refresh;
if that does not help, check whether **Task List** is off on the plugin's own page — the plugin page
lists this plugin's rows, and turning that one off does not affect the board.

**The list disappeared when I opened the board panel.** That is not a fault; the main stage shows
**one panel at a time** by design — they were never two things that fit on one screen. Click the list
row in the sidebar to go back to it, or "back to conversation" to leave either panel.

**`dsh plugin` cannot find pnpm.** Install pnpm (`npm install -g pnpm`) and re-run.

## Naming

| Purpose | Value |
| --- | --- |
| Plugin id | `dsh-task-board` |
| npm package | `@firetruck666/dsh-task-board` |
| Permission preset route | `/api/dsh-task-board/permissions` |
| Board data route | `/api/dsh-task-board/board` (`/items`, `/surfaces`, `/ask`, `/lease`, `/command`, `/events`) |
| Other host routes | `/api/dsh-task-board/session-state`, `/update`, `/client-report` |
| Host storage unit | `dsh_task_board` (one file per data kind under `documents/`) |
| Board stage slot | `main` (`key: dsh-task-board`) |
| Task list stage slot | `main` (`key: dsh-task-board-items`; same seat as the board, different key) |
| Sidebar entry slot | `sidebar.panellist` (`id` matches each panel's `main` key) |
| `localStorage` keys | `dsh.taskBoard.v1` and friends |

The plugin id and the package name are different things. The id names the loader row, the served browser asset, the routes, the storage unit and the extension points above; the package name is only what pnpm installed. A scoped package name never moves the id.

The plugin has no settings of its own, so there is no settings route and no settings page: the switch in the plugin marketplace writes `disabled` on the profile row, and the plugin declares no setting fields.

## License

MIT. See [LICENSE](LICENSE).
