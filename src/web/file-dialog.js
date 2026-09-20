/**
 * In-app file browser for Open, Save as, and choosing the workspace folder.
 * The local server reads the file system, so documents keep a real path and
 * can be saved back in place (a browser file input only yields contents).
 */

const DOCUMENT_EXTENSION = '.json';

const ICONS = {
  folder: '<path d="M3 6.5h6l2 2h10v10H3z" fill="currentColor" fill-opacity=".16"/><path d="M3 6.5V5h7l2 2"/>',
  document: '<path d="M6 3h8l4 4v14H6z" fill="currentColor" fill-opacity=".16"/><path d="M14 3v5h4M9 16h2l1-3 2 5 1-2h1"/>',
  json: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4"/>',
  up: '<path d="M12 19V6m0 0-5 5m5-5 5 5"/>',
  home: '<path d="M4 11 12 4l8 7M6.5 9.5V20h11V9.5"/>',
  workspace: '<path d="M4 5h16v14H4z"/><path d="M4 9h16"/>',
  'new-folder': '<path d="M3 6.5h6l2 2h10v10H3z"/><path d="M12 11.5v5M9.5 14h5"/>',
};

function svgIcon(name) {
  return `<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
}

function element(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children);
  return node;
}

const TITLES = {
  open: ['Open document', 'Open'],
  save: ['Save document as', 'Save'],
  folder: ['Choose workspace folder', 'Use this folder'],
};

/**
 * @param {object} persistence adapter from persistence.js
 * @param {{mode:'open'|'save'|'folder', dir?:string, name?:string, title?:string}} options
 * @returns {Promise<null | {path:string} | {dir:string, name:string}>}
 */
export function showFileDialog(persistence, { mode = 'open', dir = '', name = '', title: customTitle } = {}) {
  const [defaultTitle, actionLabel] = TITLES[mode];
  const title = customTitle || defaultTitle;
  let listing = null;
  let selectedPath = null;
  let result = null;

  const pathInput = element('input', { type: 'text', class: 'file-dialog-path', 'aria-label': 'Folder path', spellcheck: 'false', autocomplete: 'off' });
  const status = element('p', { class: 'file-dialog-status', role: 'status' });
  const list = element('ul', { class: 'file-dialog-list', role: 'listbox', tabindex: '0', 'aria-label': 'Folder contents' });
  const nameInput = element('input', { type: 'text', class: 'file-dialog-name', value: name, 'aria-label': 'Document name', spellcheck: 'false', autocomplete: 'off' });
  const actionButton = element('button', { type: 'submit', class: 'confirm-action', text: actionLabel });
  const navButton = (icon, label, onclick) => element('button', { type: 'button', class: 'icon-button', title: label, 'aria-label': label, html: svgIcon(icon), onclick });
  const newFolderButton = element('button', { type: 'button', html: `${svgIcon('new-folder')}<span>New folder</span>`, onclick: () => startNewFolder() });

  const form = element('form', { class: 'file-dialog-form' }, [
    element('h2', { text: title }),
    element('div', { class: 'file-dialog-nav' }, [
      navButton('up', 'Parent folder (Backspace)', () => listing?.parent && navigate(listing.parent)),
      navButton('home', 'Home folder', () => listing?.home && navigate(listing.home)),
      navButton('workspace', 'Workspace folder', () => listing?.workspace && navigate(listing.workspace)),
      pathInput,
    ]),
    list,
    status,
    ...(mode === 'save' ? [element('label', { class: 'file-dialog-name-row' }, [
      element('span', { text: 'Name' }), nameInput, element('span', { class: 'file-dialog-extension', text: DOCUMENT_EXTENSION }),
    ])] : []),
    element('div', { class: 'dialog-actions' }, [
      ...(mode === 'open' ? [] : [newFolderButton]),
      element('span', { class: 'dialog-actions-spacer' }),
      element('button', { type: 'button', text: 'Cancel', onclick: () => dialog.close() }),
      actionButton,
    ]),
  ]);
  const dialog = element('dialog', { class: 'confirm-dialog file-dialog', 'aria-label': title }, [form]);

  function setStatus(text, error = false) {
    status.textContent = text;
    status.classList.toggle('error', error);
  }

  function updateAction() {
    const selected = listing?.entries.find((entry) => entry.path === selectedPath);
    if (mode === 'open') actionButton.disabled = !selected || selected.type === 'folder';
    else if (mode === 'save') actionButton.disabled = !nameInput.value.trim() || !listing;
    else actionButton.disabled = !listing;
  }

  function select(path, focus = false) {
    selectedPath = path;
    for (const item of list.children) {
      const active = item.dataset.path === path;
      item.setAttribute('aria-selected', String(active));
      if (active && focus) item.scrollIntoView({ block: 'nearest' });
    }
    const entry = listing?.entries.find((candidate) => candidate.path === path);
    if (mode === 'save' && entry && entry.type !== 'folder') nameInput.value = entry.name.replace(/\.json$/i, '');
    updateAction();
  }

  function activate(entry) {
    if (!entry) return;
    if (entry.type === 'folder') navigate(entry.path);
    else if (mode === 'open') { result = { path: entry.path }; dialog.close(); }
    else if (mode === 'save') { select(entry.path); form.requestSubmit(); }
  }

  async function navigate(target) {
    setStatus('Loading…');
    try {
      listing = await persistence.browse(target);
    } catch (error) {
      setStatus(error.message, true);
      if (listing) pathInput.value = listing.dir;
      return;
    }
    pathInput.value = listing.dir;
    selectedPath = null;
    const visible = listing.entries.filter((entry) => mode !== 'folder' || entry.type === 'folder');
    list.replaceChildren(...visible.map((entry) => element('li', {
      role: 'option',
      class: `file-dialog-entry ${entry.type}`,
      'data-path': entry.path,
      'aria-selected': 'false',
      title: entry.path,
      html: `${svgIcon(entry.type)}<span class="file-dialog-entry-name"></span>`,
      onclick: () => select(entry.path),
      ondblclick: () => activate(entry),
    })));
    visible.forEach((entry, index) => { list.children[index].querySelector('.file-dialog-entry-name').textContent = entry.name; });
    const documents = visible.filter((entry) => entry.type !== 'folder').length;
    setStatus(mode === 'folder'
      ? `${visible.length} folder${visible.length === 1 ? '' : 's'}`
      : visible.length ? `${documents} document file${documents === 1 ? '' : 's'}` : 'This folder is empty.');
    updateAction();
  }

  function startNewFolder() {
    if (!listing || list.querySelector('.file-dialog-new-folder')) return;
    const input = element('input', { type: 'text', 'aria-label': 'New folder name', placeholder: 'New folder name', spellcheck: 'false' });
    const row = element('li', { class: 'file-dialog-entry folder file-dialog-new-folder', html: svgIcon('folder') }, [input]);
    const finish = async (create) => {
      const folderName = input.value.trim();
      row.remove();
      if (!create || !folderName) return;
      try {
        const { path } = await persistence.createFolder(listing.dir, folderName);
        await navigate(path);
      } catch (error) {
        setStatus(error.message, true);
      }
    };
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); list.focus(); }
    });
    input.addEventListener('blur', () => { if (row.isConnected) finish(false); });
    list.prepend(row);
    input.focus();
  }

  pathInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    navigate(pathInput.value.trim());
  });
  nameInput.addEventListener('input', updateAction);
  list.addEventListener('keydown', (event) => {
    const items = [...list.querySelectorAll('[role="option"]')];
    const index = items.findIndex((item) => item.dataset.path === selectedPath);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = items[Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
      if (next) select(next.dataset.path, true);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      activate(listing?.entries.find((entry) => entry.path === selectedPath));
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      if (listing?.parent) navigate(listing.parent);
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!listing) return;
    if (mode === 'open') {
      const entry = listing.entries.find((candidate) => candidate.path === selectedPath);
      if (!entry || entry.type === 'folder') return;
      result = { path: entry.path };
    } else if (mode === 'save') {
      const documentName = nameInput.value.trim();
      if (!documentName) return;
      result = { dir: listing.dir, name: documentName.replace(/\.schematic\.json$/i, '').replace(/\.json$/i, '') };
    } else {
      const entry = listing.entries.find((candidate) => candidate.path === selectedPath && candidate.type === 'folder');
      result = { path: entry ? entry.path : listing.dir };
    }
    dialog.close();
  });
  // Keep editor hotkeys out of the dialog.
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); dialog.close(); }
    event.stopPropagation();
  });

  document.body.append(dialog);
  updateAction();
  dialog.showModal();
  navigate(dir).then(() => (mode === 'save' ? nameInput : list).focus());
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    }, { once: true });
  });
}

/** Small promise-based confirmation, styled like the other editor dialogs. */
export function confirmChoice({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
  const dialog = element('dialog', { class: 'confirm-dialog', 'aria-label': title }, [
    element('form', { method: 'dialog' }, [
      element('h2', { text: title }),
      element('p', { text: message }),
      element('div', { class: 'dialog-actions' }, [
        element('button', { value: 'cancel', text: cancelLabel }),
        element('button', { value: 'confirm', class: danger ? 'danger-action' : 'confirm-action', text: confirmLabel }),
      ]),
    ]),
  ]);
  dialog.addEventListener('keydown', (event) => event.stopPropagation());
  document.body.append(dialog);
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(dialog.returnValue === 'confirm');
    }, { once: true });
  });
}
