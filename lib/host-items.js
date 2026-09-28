import { t as markSurfaceActive } from "./surfaces-F4JByhCB.js";
//#region src/host-items.ts
/**
* Host row: the task list panel's switch.
*
* See `host-board.ts` for why a panel switch is a host-side row at all. This
* file is the same idea for the list: the browser reads which surfaces are on
* before it registers the panel, and this row is one of the answers.
*
* The panel itself lives in the package row's browser half, so a list with its
* row off is genuinely absent — not a row that opens onto nothing.
*/
/**
* The list panel's row. Evaluated exactly when its switch is on.
*/
markSurfaceActive("items");
/**
* Declared entry point. Nothing to do: announcing the row IS the switch.
*/
function apply() {}
//#endregion
export { apply };
