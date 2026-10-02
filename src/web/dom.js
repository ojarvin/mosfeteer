/**
 * A DOM element in one call: `props` sets `class`, `text`, `html`, `on…`
 * listeners, and attributes (true as a bare attribute; false, null, and
 * undefined left off), and `children` are appended.
 */
export function element(tag, props = {}, children = []) {
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
