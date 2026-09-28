import { t as markSurfaceActive } from "./surfaces-F4JByhCB.js";
//#region src/host-board.ts
/**
* Host rows: the two panel switches.
*
* A plugin package ships ONE browser artifact, so the board panel and the list
* panel cannot each be a row of their own — the module table keys a client
* entry by package name. What can be a row is a host-side module, and a
* host-side module is free to do nothing except say "I am switched on".
*
* So these two files are the whole implementation of those two switches: the
* browser asks the package row which surfaces are on (see `host/surfaces.ts`)
* before it registers either panel, and these rows are the answer's source.
*
* They are deliberately the smallest files in the project. A switch does not
* need a feature; it needs a fact, and the fact is "this row was evaluated".
*
* THE PANELS THEMSELVES still live in the package row's browser half, so a
* panel is genuinely absent when its row is off rather than present and inert.
*/
/**
* The board panel's row. Evaluated exactly when its switch is on.
*
* Announced in the module body, not in `apply`, so a loader that imports
* without calling `apply` still counts the row as on.
*/
markSurfaceActive("board");
/**
* Declared entry point. Nothing to do: announcing the row IS the switch.
*/
function apply() {}
//#endregion
export { apply };
