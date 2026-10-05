/**
 * Long explanations, folded: a hint paragraph past a sentence or two shows
 * its first sentence and a "More" link; the rest opens in place. The
 * reasons stay one click away instead of always filling the window.
 *
 * Only plain hints fold (`p.field-hint` with no other class: a status line
 * carries its own class and always shows in full), and only when what would
 * be hidden is worth hiding.
 */

const FOLD_FROM = 150; // characters: shorter hints show in full
const MIN_HIDDEN = 50; // characters: never hide a short tail

/** Where the first sentence ends: [text node, offset just past its stop], or null. */
function firstSentenceEnd(paragraph) {
  let seen = 0;
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    // Only a text node directly in the paragraph splits cleanly.
    if (node.parentNode === paragraph) {
      const match = /[.!?]\s+(?=[A-Z(])/g;
      match.lastIndex = Math.max(0, 40 - seen);
      const found = match.exec(node.data);
      if (found) return [node, found.index + 1];
    }
    seen += node.data.length;
  }
  return null;
}

/** Fold one hint paragraph (once). */
export function foldHint(paragraph) {
  if (paragraph.dataset.folded !== undefined) return;
  paragraph.dataset.folded = '';
  const total = paragraph.textContent.length;
  if (total < FOLD_FROM || paragraph.querySelector('button, input, select, a')) return;
  const end = firstSentenceEnd(paragraph);
  if (!end) return;
  const [node, offset] = end;
  const tail = node.splitText(offset);
  const rest = document.createElement('span');
  rest.className = 'hint-rest';
  for (let next = tail; next;) {
    const after = next.nextSibling;
    rest.append(next);
    next = after;
  }
  if (rest.textContent.trim().length < MIN_HIDDEN) {
    paragraph.append(...rest.childNodes);
    paragraph.normalize();
    return;
  }
  rest.hidden = true;
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'hint-more';
  more.textContent = 'More';
  more.setAttribute('aria-expanded', 'false');
  // Open, the link moves to the end of the paragraph, after what it showed.
  more.addEventListener('click', () => {
    const open = rest.hidden;
    rest.hidden = !open;
    if (open) rest.after(more);
    else rest.before(more);
    more.textContent = open ? 'Less' : 'More';
    more.setAttribute('aria-expanded', String(open));
  });
  paragraph.append(' ', more, rest);
}

const isPlainHint = (node) => node instanceof HTMLElement && node.matches('p.field-hint') && node.classList.length === 1;

/** Fold every plain hint under `root`, now and as it is rebuilt. */
export function installHintFolding(root) {
  if (!root) return;
  const foldAll = (scope) => {
    if (isPlainHint(scope)) foldHint(scope);
    for (const hint of scope.querySelectorAll?.('p.field-hint') || []) if (isPlainHint(hint)) foldHint(hint);
  };
  foldAll(root);
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) foldAll(node);
  }).observe(root, { childList: true, subtree: true });
}
