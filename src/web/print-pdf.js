/**
 * A PDF in the browser-only build: no program can print one to a file here,
 * so the page to print opens in the browser's own print dialog, where "Save
 * as PDF" makes the PDF (vector, its text selectable). The document's pages
 * size the paper (CSS `@page`): the drawings' own sizes (core/print-pages.js)
 * or the report's pages (core/report.js). The suggested file name is `name`.
 */

/** Open the print dialog on `html`. Resolves once the dialog has closed. */
export function printHtml(html, { name = '' } = {}) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.className = 'print-frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    // Off screen but laid out: a frame with no size can print blank.
    Object.assign(frame.style, { position: 'fixed', left: '-10000px', top: '0', width: '800px', height: '600px', border: '0' });
    frame.addEventListener('load', () => {
      const win = frame.contentWindow;
      if (!win) {
        frame.remove();
        reject(new Error('the print view did not open'));
        return;
      }
      // The dialog offers the page's title as the file name; the frame's
      // title for its own document, the window's in some browsers.
      const title = document.title;
      if (name) document.title = name;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        document.title = title;
        setTimeout(() => frame.remove(), 0);
        resolve();
      };
      win.addEventListener('afterprint', done, { once: true });
      // A task after the load: everything the load set up has run first.
      setTimeout(() => {
        try {
          win.focus();
          // Blocks until the dialog closes where the browser supports it.
          win.print();
        } catch (error) {
          document.title = title;
          frame.remove();
          reject(error);
          return;
        }
        // A browser that returns before the dialog closes still fires
        // afterprint; one that never does is let go after a while.
        setTimeout(done, 60_000);
      }, 0);
    }, { once: true });
    frame.srcdoc = html;
    document.body.append(frame);
  });
}
