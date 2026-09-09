// vendored from CoreFrame/runtime/ctrl.js @ b0a5860 -- verbatim; re-sync with CoreFrame/tools/sync-to.sh
// ctrl.js - the control words shared by worker.js and client.js (a small
// SharedArrayBuffer beside the arena). Kept apart so the page can import them
// without importing the worker's body.
export const CTRL_KICK = 0, CTRL_SEQ = 1, CTRL_STATE = 2, CTRL_EXIT = 3, CTRL_CYCLES_LO = 4, CTRL_CYCLES_HI = 5, CTRL_WORDS = 8;
export const STATE_BOOT = 0, STATE_RUNNING = 1, STATE_IDLE = 2, STATE_EXITED = 3;
