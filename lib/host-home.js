import { t as markSurfaceActive } from "./surfaces-BuEee2Eb.js";
//#region src/host-home.ts
/**
* Host row: the workbench overview's switch.
*
* See `host-board.ts` for why a panel switch is a host-side row at all. This is
* the third product surface: the board and the list each own one, and the
* overview — the page that answers 「今天该我出手什么」 — owns the third.
*
* A page whose row is off is genuinely absent, not a tab that opens onto
* nothing: the browser reads which surfaces are on before it registers any
* panel, and the workbench bar renders exactly the destinations that exist.
*/
/**
* The overview's row. Evaluated exactly when its switch is on.
*/
markSurfaceActive("home");
/**
* Declared entry point. Nothing to do: announcing the row IS the switch.
*/
function apply() {}
//#endregion
export { apply };
