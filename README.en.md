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

### The board

- Five columns: Backlog / To do / In progress / In Review / Done. Drag a card to another column, or up and down inside one to set the order.
- Running is real: press "run" in the detail and a DSH session does the work, landing the card in In Review when it finishes. How many times it ran, and whether the last one worked, are on the card.
- A running card carries a yellow edge; an unread one carries an outer ring.
- One line at the top of the board: how many are waiting on you, how many need review. Press it to open the notification centre.
- The notification centre collects everything waiting on you. The activity feed groups what just happened by day.
- The review page is the full record of one run, with "pass" and "send back" right there.
- The model asks its questions in the comment thread and you answer on the spot. When it needs your approval, it gives you a way into that conversation.
- Each card's comments ARE its DSH session. Queue or steer, and drag images and files straight in.
- Drag a session or a workspace in from the sidebar and you get a card bound to it.
- Two kinds of automation, each minding its own: schedules that fire on a timetable or chain onto completion, and rules that send a session an instruction on the same triggers.
- Auto-cruise: one switch in the board header, with a cap on how many run at once and the hours they may run in.
- Multi-select, then recolour, run or delete the whole selection in one go.
- Save the detail as a template and pick it when creating; run configurations save as presets, one of them the default.
- On a phone the columns become a horizontal track, and nothing is missing.

### The task list

- Press "+ new item" to write one down. The first line takes a whole item in one syntax: `#tag`, `!1` priority, `@tomorrow`, `- [ ]` step. What it recognises shows as you type; a word read wrongly turns back into plain text when you click it.
- The list stands on its own — an item does not have to become a card. When it hangs off one, it follows that card's state.
- Three independent times: earliest start, wanted-by, deadline. Only a missed deadline turns a row red, and that reading is **Past due** — a slipped plan and a broken promise are two things.
- Ticking a step draws a progress bar. Four priority tiers. Tags as you like.
- Everything that filters is in the left rail: the calendar, overdue, untouched, no date, priority, state, the agenda, and the deleted. Each row carries its number, 0 included.
- The calendar at the top of the rail moves month by month, comes back to today, and folds into a single line. Picking a day shows that day alone and leaves a **removable date chip** under the search box, so an empty list still says why it is empty.
- A row's state is said by the bead at its head: **In progress** / **To do** / **Blocked** / **Done**, four shapes, once per row.
- Title, body, notes and dates are edited in the row itself, not in another window.
- The agenda reads by day: overdue / behind / today / tomorrow / later this week / further out. Rows with no date and rows whose start has not arrived each wait in their own place, and the rows that are deliberately NOT on this agenda — finished work, and unfiled captures — are named in one line at the foot of the page, so the numbers add up.
- Delete has an undo. What you deleted sits under "deleted" at the bottom of the rail, recoverable for 30 days or erased for good.
- Multi-select, then set state, priority, a date, ask AI or delete the whole selection in one go.
- Keyboard: `A` new, `J`/`K` move, `X` multi-select, `1`–`4` priority, `E` rename, `⌘Z` undo, `Esc` closes one layer.

### Several devices, and the AI doors

- The data lives on this machine under `~/.dsh/storages/dsh_task_board/`, human-readable. Moving machines is a copy of that directory.
- Your phone opens the same data. It works offline and catches up when the connection returns.
- `/task` hands your sentence to the current session's model. `/task-continue` asks it to pick up where it left off.

**What the words on a card mean.**
The five columns are **Backlog / To do / In progress / In Review / Done**. They all read
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

**Where the entry and the switches are.** The board and the task list are two panel icons in the sidebar, beside DSH's own Plugins panel. The switches live on the plugin's own page: sidebar → Plugins → Installed → Task Board. There the four rows — board, task list, AI surface and host half — each carry one switch; turning a row off unregisters that half. If you see no entry at all, this client is still serving an older front-end bundle — refresh the page.

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
