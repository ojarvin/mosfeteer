/**
 * The editor's shared state, for the modules split out of main.js.
 *
 * main.js owns the state as module variables and defines an accessor here
 * for each one another module reads or writes, so `editor.circuit` is always
 * the live document. Modules import this object instead of importing the
 * variables, which ES modules would make read-only.
 */
export const editor = {};
