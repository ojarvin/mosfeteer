/**
 * A design's notes (`Circuit#notes`): Markdown text with `$math$`, saved
 * with the design and never drawn. Two kinds of reference tie the text to
 * the workspace:
 *
 * - a mention, `@M1` or `@V_{out}` (`@{any name}` for one with spaces),
 *   names a part or a net of the design. Part names win over net names;
 *   both compare the way the Atlas search does (`@vout` finds `V_{out}`).
 *   Renaming the part or net rewrites its mentions in the same step
 *   (`Circuit#renameComponent`, `#renameNet`).
 * - a design link, `[[amp]]`, names another design of the workspace;
 *   renaming that design relinks it like a part's link
 *   (`relinkDocumentState`).
 *
 * notes-markdown.js draws them.
 */

/** Names as mentions compare them: the Atlas search's key (design-index.js
 *  `searchKey`), lower case with markup and spacing gone. */
const searchKey = (text) => String(text ?? '').toLowerCase().replace(/[\s$\\_^{}]/g, '');

/** The longest notes kept (characters). */
export const MAX_NOTES = 200_000;

/** Notes as stored: a string, line endings unified, bounded. */
export function normalizeNotes(value) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\r\n?/g, '\n').slice(0, MAX_NOTES);
  return text.trim() ? text : '';
}

// ----- mentions ----------------------------------------------------------------

// `@` not inside a word or an address (a@b.com), then a braced name or a
// label-like one: letters, digits, underscores, an optional `_{...}`
// subscript and `^{...}` superscript.
const BARE_NAME = '[A-Za-z][A-Za-z0-9]*(?:_(?!\\{)[A-Za-z0-9]+)*(?:_\\{[^{}\\s]*\\})?(?:\\^\\{[^{}\\s]*\\})?';
export const MENTION = new RegExp(`(^|[^\\w@\\\\])@(\\{[^{}\\n]+\\}|${BARE_NAME})`, 'g');
const BARE = new RegExp(`^${BARE_NAME}$`);

/** The name a mention token spells: `{a b}` reads `a b`. */
export function tokenName(token) {
  return token.startsWith('{') ? token.slice(1, -1).trim() : token;
}

/** How a mention of `name` is written. */
export function mentionToken(name) {
  const text = String(name ?? '').trim();
  return BARE.test(text) ? `@${text}` : `@{${text}}`;
}

/** Every mention in `text`: `{ name, index, length }`, `index` at the `@`. */
export function findMentions(text) {
  const found = [];
  const source = String(text ?? '');
  for (const match of source.matchAll(MENTION)) {
    const index = match.index + match[1].length;
    found.push({ name: tokenName(match[2]), index, length: match[0].length - match[1].length });
  }
  return found;
}

/** What `name` mentions in `circuit`: `{ kind: 'component', refdes }`,
 *  `{ kind: 'net', ids, name }` (every net of that name), or null. */
export function resolveMention(circuit, name) {
  const key = searchKey(name);
  if (!key) return null;
  for (const component of circuit.components.values()) {
    if (component.type === 'solder') continue;
    if (searchKey(component.refdes) === key) return { kind: 'component', refdes: component.refdes };
  }
  for (const component of circuit.components.values()) {
    const label = circuit.labelOf(component.refdes);
    if (label?.text && searchKey(label.text) === key && component.type !== 'solder') return { kind: 'component', refdes: component.refdes };
  }
  const nets = [...circuit.nets.values()].filter((net) => net.name && searchKey(net.name) === key);
  return nets.length ? { kind: 'net', ids: nets.map((net) => net.id), name: nets[0].name } : null;
}

/** `text` with every mention of `from` (compared through markup) written as
 *  a mention of `to`. Mentions inside code are left as they are. */
export function renameMentions(text, from, to) {
  const source = String(text ?? '');
  const key = searchKey(from);
  if (!key || !source.includes('@') || searchKey(from) === searchKey(to) && from === to) return source;
  const code = codeRanges(source);
  let out = '';
  let last = 0;
  for (const mention of findMentions(source)) {
    if (searchKey(mention.name) !== key || code.some(([a, b]) => mention.index >= a && mention.index < b)) continue;
    out += source.slice(last, mention.index) + mentionToken(to);
    last = mention.index + mention.length;
  }
  return last ? out + source.slice(last) : source;
}

/**
 * The notes as plain Markdown, to read outside the editor: a mention as its
 * name (`$...$` math when it has a subscript or superscript, as it is
 * drawn), a design link as the design's name. Code is left as it is.
 */
export function notesMarkdown(text) {
  // `lead`: the characters a match takes before its reference.
  const outsideCode = (source, pattern, replace, lead = () => 0) => {
    const code = codeRanges(source);
    return source.replace(pattern, (...match) => {
      const offset = match.at(-2) + lead(match);
      return code.some(([a, b]) => offset >= a && offset < b) ? match[0] : replace(...match);
    });
  };
  const mentions = outsideCode(String(text ?? ''), MENTION, (whole, before, token) => {
    const name = tokenName(token);
    return before + (/[_^]\{/.test(name) ? `$${name}$` : name);
  }, (match) => match[1].length);
  return outsideCode(mentions, DESIGN_LINK, (whole, name) => name.trim());
}

/** Where code is (fenced blocks and inline spans), as [start, end) ranges. */
function codeRanges(text) {
  const ranges = [];
  const fence = /^```[^\n]*\n[\s\S]*?(?:^```[^\n]*$|(?![\s\S]))/gm;
  for (const match of text.matchAll(fence)) ranges.push([match.index, match.index + match[0].length]);
  for (const match of text.matchAll(/`[^`\n]+`/g)) {
    if (!ranges.some(([a, b]) => match.index >= a && match.index < b)) ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

// ----- design links --------------------------------------------------------------

export const DESIGN_LINK = /\[\[([^[\]\n|]+)\]\]/g;

/** The designs `text` links to, by name, each once. */
export function noteDesignLinks(text) {
  return [...new Set([...String(text ?? '').matchAll(DESIGN_LINK)].map((match) => match[1].trim()).filter(Boolean))];
}

/** `text` with its links to design `from` pointing at `to`; `count` is how many. */
export function relinkNotes(text, from, to) {
  let count = 0;
  const source = String(text ?? '');
  const result = source.replace(DESIGN_LINK, (whole, name) => {
    if (name.trim().toLowerCase() !== String(from).trim().toLowerCase()) return whole;
    count += 1;
    return `[[${to}]]`;
  });
  return { text: result, count };
}
