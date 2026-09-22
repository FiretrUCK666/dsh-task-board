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

- DeepSeek Harness `0.1.7-alpha.1` or later. `0.1.7-alpha.1` is the **verified minimum**: the plugin is known to work there, and it is the release that carries the settings interface this plugin uses (earlier releases lack it, and the whole host half then fails silently at load). Later releases are tracked but not individually tested, so they are not guaranteed. If loading fails, follow the Troubleshooting section.
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
| Where data lives | `~/.dsh/storages/dsh_task_board.json`, created on first run |
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

- **Five columns** — To plan, To do, In progress, Needs review, Done. Cards carry a summary only; the execution window and the comment timeline live in the detail view. Every session that finishes lands in Needs review.
- **Real execution** — Pressing Run starts a real DSH session, visible in the native session list. An execution prompt that begins with `/` runs as a native command, so `/plan ...` enters plan mode for real.
- **Multi-device sync** — The board's source of truth is the host, stored at `~/.dsh/storages/dsh_task_board.json`. The browser is an optimistic copy: the board opens instantly, works while offline, and catches up afterwards. Concurrent edits merge per record and do not depend on device clocks.
- **One engine at a time** — Scheduled runs, cruise and follow-ups are arbitrated by a host lease, so only one open GUI executes them. The device in the foreground holds the engine seat and takes over when it becomes visible.
- **Comments and conversation** — Each session row opens a panel with the live transcript on one side and usage, run configuration, the comment thread and the composer on the other. Messages queue by default or can be steered immediately. `@` mentions and `/` commands use the same mechanisms as the main composer. Images are compressed in the browser; other files upload byte for byte.
- **Attachments are content** — Send an image or a file with no words at all; the message is not required to carry text. Images are compressed in the browser, other files upload as their exact bytes. If a send is ever refused, the composer says so and keeps your draft instead of quietly handing the content back.
- **Answer the agent right there** — When a session is waiting on you (a plan to confirm, an `ask_user_question`), the interaction card appears in the comment thread with the SAME parts and behaviour as the native question card: options, a custom answer, previous/next, skip, submit or approve/decline/discuss. Answering settles the request on the spot and the model continues; "Answer in session" and "View session" still take you to the full conversation. The to-do, goal and subagent readout in the same area comes from the native panel.
- **Automation** — Task-level cron schedules and follow-on-completion chains; session-level rules that inject either a custom instruction or the task's execution prompt, on a timetable or after every completion.
- **Auto-cruise** — Batch-execute every ready task from the board header, with a global concurrency cap and time windows.
- **Parallelism counted per session** — The header's parallelism number is the single gate: it caps how many sessions run at once. Sessions on one card do not block each other; within one session, work stays ordered.
- **Mobile and narrow screens** — The layout responds to the board's own width, not the viewport, and shares one code path with the desktop. Columns scroll horizontally with an evenly divided tab strip; the header keeps every control labelled and reflows deterministically.
- **Drag and drop** — Reorder within a column, move between columns, auto-scroll at the edges, and drag sessions or workspaces in from the sidebar.
- **Templates and run presets** — Save a task as a template; store run configurations (agent, workspace, model, reasoning effort, permissions) as presets and set one as the default, with a fallback to the deployment default.
- **Notifications and activity** — An inbox aggregating sessions waiting on you plus unread tasks with review pending, and a board-wide activity feed grouped by day.

## Data locations

- Board source of truth: `~/.dsh/storages/dsh_task_board.json` (task ledger, cruise, schedule presets, run presets, deletion tombstones). Atomic single-file write; back it up directly, or delete it to clear the board.
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

**The board opens, but devices do not sync and Settings says the configuration service is unavailable.** That is what a host half which failed to load looks like, and it is the easiest failure to miss after a DSH upgrade: the board still works on the page, but its data stays in that one browser, so another device is not looking at the same board and schedules and cruise never actually fire. Fix it the same way as the entry above — update the plugin, then restart `dsh web`.

**A code change had no effect.** Changes under `src/index.ts` or `src/host/` need a `dsh web` restart; client-side changes only need a page refresh. Run `pnpm build` first in both cases.

**Scheduled work runs twice with two devices open.** It should not: scheduling, cruise and follow-ups are arbitrated by a host lease. If the header shows a stale-server notice, open it to see the start time of the server process you are connected to; an old timestamp means a different, un-restarted instance is serving that address.

**Moving to another machine.** Copy `~/.dsh/storages/dsh_task_board.json`. The browser `localStorage` is only a mirror.

**`dsh plugin` cannot find pnpm.** Install pnpm (`npm install -g pnpm`) and re-run.

## Naming

| Purpose | Value |
| --- | --- |
| Plugin id | `dsh-task-board` |
| npm package | `@firetruck666/dsh-task-board` |
| Settings route | `/api/dsh-task-board/settings` |
| Permission preset route | `/api/dsh-task-board/permissions` |
| Board data route | `/api/dsh-task-board/board` (`/lease`, `/command`, `/events`) |
| Host storage unit | `dsh_task_board` |
| Board stage slot | `main` (`key: dsh-task-board`) |
| Sidebar entry slot | `sidebar.panellist` (`id: dsh-task-board`) |
| `localStorage` keys | `dsh.taskBoard.v1` and friends |

The plugin id and the package name are different things. The id names the loader row, the served browser asset, the settings entry, the routes, the storage unit and the two slots above; the package name is only what pnpm installed. A scoped package name never moves the id.

This plugin has no settings, so it has no settings panel either: the switch in the plugin manager writes the profile row's `disabled` (and only when you turn it off), and the plugin itself declares no setting fields.

## License

MIT. See [LICENSE](LICENSE).
