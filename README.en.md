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

- DeepSeek Harness `0.2.2-alpha.2` or later. This is the **minimum supported version** (the release the plugin is built and tested against), not "the current one": anything older is untested, and there is no upper bound — the plugin is updated alongside DSH, so just install the latest build after upgrading DSH. If loading fails, follow the Troubleshooting section.
- For the web GUI (a `dsh web` you started yourself): Node.js `^22.19.0` or `>= 24.0.0`, and pnpm 10 or newer.
- The **desktop app needs neither**: it ships its own Node and pnpm and runs package operations on its own runtime.

## Install

One thing decides every command below: **the desktop app and the web GUI are two separate installs.**

Each has its own profile (`~/.dsh/profiles/<name>`). A plugin installed into one profile is visible
to that surface and no other — installing it in the web GUI does not give you it in the desktop app,
and the other way round. The two surfaces look identical and install the same way, but they install
**separately**.

| What you are using | Its profile | Who owns it |
| --- | --- | --- |
| The desktop app (DSH Desktop) | `desktop` | the app itself (it ships the runtime) |
| `dsh web` (the GUI you started) | `web` | you, or whatever profile name you launched |

So there is one rule: **install into the profile of the surface you are using.** Replace `<profile>`
below with the word from that table.

### The desktop app

**Use the app's own plugin page** — no terminal involved.

Sidebar → Plugins → Add plugin → package name `@firetruck666/dsh-task-board` → pick an install
source → Install.

A terminal works too, but **only with the right `dsh`**: that profile is honoured by the application's
own command line and refused by the one npm installs:

```
error: profile "desktop" is managed exclusively by the Electron application
```

To use a terminal, first have the app put its own `dsh` on the system: the menu's **Manage dsh
Command…** (directly under Check for Updates…) does it in one step — on Windows into your user PATH,
on macOS as `/usr/local/bin/dsh`. Then:

```sh
dsh plugin --profile desktop add @firetruck666/dsh-task-board
```

Two things must be true first, or the command fails: the app has been **opened at least once** (it
creates its own profile), and it is **fully quit** (while it runs, the files are locked).

### The web GUI

```sh
dsh plugin --profile web add @firetruck666/dsh-task-board
```

### Where the package comes from

Either command above only says *which profile*; the package name says *what*. There are three forms.

#### From npm

```sh
dsh plugin --profile <profile> add @firetruck666/dsh-task-board
```

Installs the most recent release. This is the right choice for everyday use.

#### From GitHub

```sh
dsh plugin --profile <profile> add github:FiretrUCK666/dsh-task-board
```

Installs the current `main` branch. Like the npm install this is a ready-to-use package, not a development environment: it has no tests and no build tooling, so the code cannot be changed in place. Use it to pick up unreleased changes early; stability depends on the state of the branch at that moment.

#### From a local checkout

In the repository directory:

```sh
pnpm install
pnpm build
dsh plugin --profile <profile> add .
```

This is the path for changing the code. See "Building from source" below.

A local install links to your working directory rather than copying it, so one install is enough: after changing code, just run `pnpm build` and restart `dsh web` — do not re-run the install command above. Client-half changes need only a page refresh; host-half changes need the restart. See "A code change had no effect" under Troubleshooting.

#### How the three differ

The first two are installs: each delivers a ready-to-use package containing only the files in the publish list (runtime code, source, the bundle patch, documentation). The third is development: a full checkout you can edit and test.

| | npm | GitHub | Local |
| --- | --- | --- | --- |
| Purpose | install and use | install and use | development |
| You get | latest release | current `main` | your working tree |
| Version | stable | newest, may be less stable | whatever you have |
| Update source | npm version | the repository's default branch | not applicable |

An npm install and a GitHub install contain essentially the same files; they differ in how new the code is. Install from GitHub to pick up unreleased changes, from npm for a stable release.

### After installing

**Restart that surface**: stop the running `dsh web` and start it again, or fully quit and reopen the
desktop app. Refreshing the page is not enough: the host half of the plugin loads inside the server
process. The **Task Board** entry appears in the sidebar after the restart.

The entry sits beside DSH's own Plugins panel. Selecting it puts the board in the centre stage; selecting the entry again — or any session in the sidebar — brings the conversation back.

The plugin's switches live in two places, and they do different jobs. The toggle on the plugin's row under **sidebar → Plugins → Installed** is the **master switch**; the one at the top right of the plugin's own page (click the plugin name) does the same thing. **Off means the plugin is not loaded** (sidebar entry, board, overview, list and background routes all stop); **on restores it.** Under "Included components" on that page there are **four more rows, one switch each**, governing their own half (board / overview / list / AI interface) — see the FAQ.

### Try it once

Two minutes after the restart is enough to see what this does:

1. Open **Task Board** in the sidebar, press **+ new item**, and write down one thing you actually
   have to do (a title is enough).
2. Open that row in the left rail, pick a workspace and an agent under the run configuration on the
   right, and press **Ask AI** — it becomes a card on the spot and a session starts working.
3. Back on the board: the card is in progress, and it lands in In Review by itself when the run
   finishes. The numbers along the top start reporting.
4. Open the card, read the result, press Pass.

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

The one step you must take is **restarting that surface** (the host half lives in the server process and is not loaded otherwise). All three install routes — npm, GitHub, local — behave identically here, and so do the two surfaces.

This plugin has no settings and needs no settings panel: the board's behavior (tasks, schedules, cruise, rules) is edited directly on the board, and on/off is the switch above.

To remove it:

```sh
dsh plugin --profile <profile> remove @firetruck666/dsh-task-board
```

A restart is required here too. Your task data is not deleted.

## Updating

The board header's right toolbar has a permanent **Check for updates** button. One click answers
three questions: **which copy is running** (which profile, where it lives, how it was installed),
**whether there is a newer one**, and **how to get it**.

It reads **the running copy's own location and manifest** rather than a name written into the code,
so a local checkout on the web profile and an npm install inside the desktop app each describe
themselves on the same machine. The latest version is read **by the host** as well: only it knows
which registry this profile actually uses (official, a mirror, or an internal one), so a browser
that cannot reach `registry.npmjs.org` no longer turns into "check failed". When it cannot read the
latest version it says exactly that — it never reports "up to date" it cannot prove.

| Installed via | What Update now does |
| --- | --- |
| npm | uninstalls, then installs the latest published version |
| GitHub | uninstalls, then reinstalls at the current state of the repository's default branch |
| a local checkout | `git pull --ff-only` in the repository, then rebuilds `lib/` with the package manager that repository declares |

Uninstall-then-install is DSH's own update route (with HMR live it refuses to install over an
installed package), so the plugin disappears for a few seconds. A restart may be needed afterwards,
and **if the install fails the plugin stays uninstalled** — put it back the way you installed it.
**Your task data is never touched** at any point: it lives in
`~/.dsh/storages/dsh_task_board/`, not in the package.

When the version has **not** changed, the dialog says exactly that instead of claiming an update —
the run did not install the new version, which is not the same thing as failing. Two usual causes:
the **installer's own release-age policy** (a package manager holds back a version published minutes
ago — measured: an install run within the first ten minutes still lands on the previous one, so press
it again once that window has passed), and the **version range this profile recorded**, which is what
the **Declared as** line shows; uninstalling and installing again re-resolves it. Those three lines —
which copy is running, where it lives, what it declares — answer "which one is this machine actually
running" for good.

The dialog also shows the equivalent terminal command (except on the desktop app, for the reason
below), with your own profile name in it:

```sh
dsh plugin --profile <profile> add @firetruck666/dsh-task-board@latest
```

```sh
dsh plugin --profile <profile> add github:FiretrUCK666/dsh-task-board
```

For a local checkout:

```sh
git pull --ff-only && pnpm run build
```

**Desktop app**: that profile is the app's own, and the command above does not hold for it — the
`dsh` npm installs refuses the `desktop` profile name, so that dialog offers no terminal line and
points at the app's plugin page instead. Uninstall and re-add the package there to update. (The `dsh`
the app's own menu installs is accepted; see Install.)

With the plugin marketplace installed you can also press Update on its Installed tab.

## What it does

### One workbench, three pages

The sidebar carries **Overview**, **Task board** and **Task list**, and the three share one navigation
bar at the top — so which page you are on, and how much is waiting on each of the others, is visible
at a glance.

- **Overview**: four numbers (waiting on you, finished-but-unseen, due today, overdue), one pipeline
  row (how many cards in each column, and how long the oldest has sat still), the last seven days of
  output, and what happened most recently. Press a number to land on that page.
- **They connect, and they also stay apart.** A card's "N items" chip jumps to the list filtered to
  that card; a row's card chip jumps back to the board and opens that card. Ignore those chips and the
  two pages go their own way.
- **Each page can be switched off on its own**: one toggle per page in the plugin details, and a page
  that is off simply is not in the bar.

### The board

Five columns, and reading them left to right is the whole life of a piece of work: Backlog / To do /
In progress / In Review / Done. Drag a card between columns, or up and down inside one to set the
order.

- **Running is real.** Press "run" in the detail and a DSH session actually does the work, landing
  the card in In Review when it finishes. How many times it ran and whether the last one worked are
  on the card; a running card carries a yellow edge.
- **Things waiting on you surface by themselves.** One line along the top: how many sessions have a
  question parked, how many cards need your verdict. Pressing it opens the notification centre, and
  the activity feed groups what happened by day.
- **The model asks in the comment thread and you answer on the card.** A plan waiting for approval
  works the same way — approve it, or send it back to the composer, without a trip into the
  conversation. Each card's comments ARE its DSH session: queue or steer, and drag images and files
  straight in.
- **Quote a line, then ask about it.** Select text in the conversation and a "Quote text" button
  appears beside it. Pressing it puts that text into the composer as a quote line, so you can carry
  on writing underneath it. What goes in is plain text, and it renders as a quote block in the
  thread — the same thing as quoting a line in a DSH conversation.
- **The conversation folds one turn at a time: you say one thing, it answers with one thing.**
  The process in between (which tools ran, a moment of thinking, which context was injected)
  folds into one expandable row, leaving only the final answer once the run finishes. Open the
  row to read the detail. How much folds, when it folds, and which replies survive the fold all
  follow the three settings under "Settings · General" — this panel does not open a second set.
- **Drag a session or a workspace in from the sidebar and you get a card bound to it.**
- The review page is the full record of one run, with "pass" and "send back" right there.
- Multi-select, then recolour, run or delete the whole selection in one go. Save the detail as a
  template; run configurations save as presets, one of them the default.

### The task list

Some things are not ready to be worked on yet. Write them down first.

- Press "+ new item": **the title comes first**, then body, steps and context notes. The left column is what you write, the right column is what you decide — priority, state, tags, the three dates, and which card it hangs off.
- **Whether it hangs off a card is yours to choose**: no card (write it down, decide later), an existing card (nothing inside that card moves), or a new card — and for a new card you first see **what that card will run with** (workspace / agent / model / effort / permission) and it is born with what you saw.
- A row's own state is **five steps**, in the board's own words and colours. With no card you pick freely; with a card it follows that card — but **your own "Done" outranks the card**: a finished thing does not turn back into unfinished work because the card is still running. That state chip is pressable: it takes you to the board and opens the card the row hangs off.
- **"Ask AI" is the only press on this page that hands a row to a model, and it works on a row with no card**: if the card already has a conversation this is said into it, and if it has none this opens a run — **the card decides which**, so you never have to. What travels is the row itself (title, tags, body, steps, notes, and the images and files its body carries), not the card's run prompt, so a card whose own prompt is blank does not block it.
- Everything that filters is in the left rail: the calendar, by date, by time untouched, priority, state, the agenda, and the deleted. Each row carries its number, 0 included.
- Delete has an undo, and what you deleted sits under "deleted" for 30 days — recoverable, or erased for good.
- Three independent times: start, target, deadline. Only a missed deadline turns a row red, and that row reads **Past due**; a slipped target reads **behind** — a broken promise and a moved plan are not the same thing.
- Three details that are easy to miss: **the date boxes understand plain words** (`@tomorrow`, `10月15日`, `2026-10-15`, `+3`, `Wed`), and a spelling it cannot read is taught back to you rather than silently dropped; **the height of the body and notes boxes is yours** — grab anywhere along the bottom edge and it remembers; and on a phone the five columns become a horizontal track with nothing missing.

### Automation, several devices, and the AI doors

- **Schedules** that fire on a timetable or chain onto completion.
- **Rules** that send a session an instruction on the same triggers; the instruction can carry images and files, and the row says how many it holds.
- **Auto-cruise**: one switch in the board header, with a cap on how many run at once and the hours they may run in.
- Your phone opens the same data, and changes sync live. It works offline and catches up when the connection returns.
- `/task` hands your sentence to the current session's model. `/task-continue` asks it to pick up where it left off.
- Keyboard: `A` new, `J`/`K` move, `X` multi-select, `1`–`4` priority, `E` rename, `⌘Z` undo, `Esc` closes one layer.

**What the words on a card mean.**
The five columns are **Backlog / To do / In progress / In Review / Done**. They all read
from **one derivation**, so the same card gives the same answer wherever you see it:

| The word you see | What it is saying | When it goes away |
| --- | --- | --- |
| **Waiting for you** (on failure: also *paused*) | The card is in **In Review** and there is a result from that **conversation** you have not looked at | Open that conversation's thread, or press Pass / Send back |
| **N waiting** | N conversations have a question parked for you (approval / plan confirm / a question) | **Answer on that card right in the board** — approve, ask for changes, or pick one of the options it offers; going into the conversation is optional |
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

### Design system preview

When you are working on the interface there is a page to compare against: set `DSH_TASK_BOARD_DESIGN_PREVIEW=1`
before starting, and the sidebar grows a "Design system" row. It lays out the design variables, the type
ladder, every button and chip variant, the five statuses, every icon, the data palette, the feedback
grammar and the breakpoint table at once — and every specimen is **the real component itself**, so what
you see there is what the panels render.

```sh
DSH_TASK_BOARD_DESIGN_PREVIEW=1 pnpm dsh web   # or add that variable to however you start it
```

It is registered only when that variable is set, so without it the page **does not exist at all** — no
extra switch on the plugin page, and nothing for an ordinary user to run into.

## Contributing

Issues and pull requests are welcome. Before you start, read [CONTRIBUTING.md](CONTRIBUTING.md): development setup, the pre-PR checklist and the hard rules. Load-failure reports should include three things: your DSH version, the plugin version and the error text.

## Troubleshooting

**No sidebar entry after installing.** The host half loads in the server process. Restart `dsh web`; refreshing the page is not enough.

**Where the entry and the switches are.** The board, the overview and the task list are three panel icons in the sidebar, beside DSH's own Plugins panel. The switches live on the plugin's own page: sidebar → Plugins → Installed → Task Board. There the five rows — board, overview, task list, AI surface and host half — each carry one switch; turning a row off unregisters that half. If you see no entry at all, this client is still serving an older front-end bundle — refresh the page.

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
| Board data route | `/api/dsh-task-board/board` (`/items`, `/surfaces`, `/lease`, `/command`, `/events`) |
| Other host routes | `/api/dsh-task-board/session-state`, `/update`, `/client-report`, `/attachments` (takes bytes, reads them back by ref) |
| Host storage unit | `dsh_task_board` (one file per data kind under `documents/`) |
| Board stage slot | `main` (`key: dsh-task-board`) |
| Task list stage slot | `main` (`key: dsh-task-board-items`; same seat as the board, different key) |
| Overview stage slot | `main` (`key: dsh-task-board-home`) |
| Design preview stage slot | `main` (`key: dsh-task-board-design`; registered in development only) |
| Sidebar entry slot | `sidebar.panellist` (`id` matches each panel's `main` key) |
| `localStorage` keys | `dsh.taskBoard.v1` and friends |

The plugin id and the package name are different things. The id names the loader row, the served browser asset, the routes, the storage unit and the extension points above; the package name is only what pnpm installed. A scoped package name never moves the id.

The plugin has no settings of its own, so there is no settings route and no settings page: the switch in the plugin marketplace writes `disabled` on the profile row, and the plugin declares no setting fields.

## License

MIT. See [LICENSE](LICENSE).
