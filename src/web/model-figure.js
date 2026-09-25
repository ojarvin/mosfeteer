/**
 * The full-size small-signal model figure: a dialog over the analysis dock
 * that pans and zooms the model drawing like the canvas.
 */

import { svgString } from '../core/render.js';
import { canvasEl, circuitNameEl, analysisModelOpen, modelDialog, modelDialogTitle, modelDialogFigure, modelDialogNotes, modelDialogRubber } from './elements.js';
import { editor } from './editor-state.js';

let modelFigureView = null;

let modelFigureFit = null;

let modelFigureDrag = null;

function modelFigureSvg() {
  return modelDialogFigure?.querySelector('svg') || null;
}

/** Client point in the figure's own world units, via its live transform. */
function modelFigureWorld(clientX, clientY) {
  const svg = modelFigureSvg();
  const ctm = svg?.getScreenCTM?.();
  if (!ctm) return null;
  const point = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: point.x, y: point.y };
}

function applyModelFigureView() {
  const svg = modelFigureSvg();
  if (!svg || !modelFigureView) return;
  const { x, y, w, h } = modelFigureView;
  svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
}

function readModelFigureView() {
  const box = modelFigureSvg()?.viewBox?.baseVal;
  modelFigureFit = box?.width && box?.height
    ? { x: box.x, y: box.y, w: box.width, h: box.height }
    : null;
  modelFigureView = modelFigureFit ? { ...modelFigureFit } : null;
  modelFigureDrag = null;
}

function fitModelFigure() {
  if (!modelFigureFit) return;
  modelFigureView = { ...modelFigureFit };
  applyModelFigureView();
}

/** Zoom limits: never past a whole cell per pixel, never past the whole drawing. */
function zoomModelFigure(factor, about) {
  if (!modelFigureView || !modelFigureFit) return;
  const min = Math.min(modelFigureFit.w / 64, 200);
  const max = modelFigureFit.w * 4;
  const width = Math.min(Math.max(modelFigureView.w * factor, min), max);
  const scale = width / modelFigureView.w;
  const anchor = about || {
    x: modelFigureView.x + modelFigureView.w / 2,
    y: modelFigureView.y + modelFigureView.h / 2,
  };
  modelFigureView = {
    x: anchor.x - (anchor.x - modelFigureView.x) * scale,
    y: anchor.y - (anchor.y - modelFigureView.y) * scale,
    w: width,
    h: modelFigureView.h * scale,
  };
  applyModelFigureView();
}

function zoomModelFigureToRect(rect) {
  if (!modelFigureView || rect.w < 4 || rect.h < 4) return;
  const aspect = modelFigureView.w / modelFigureView.h;
  let w = rect.w;
  let h = rect.h;
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  modelFigureView = { x: rect.x + rect.w / 2 - w / 2, y: rect.y + rect.h / 2 - h / 2, w, h };
  applyModelFigureView();
}

function modelFigureRubber(from, to) {
  if (!modelDialogRubber) return;
  const area = modelDialogFigure.getBoundingClientRect();
  modelDialogRubber.hidden = !from || !to;
  if (!from || !to) return;
  modelDialogRubber.style.left = `${Math.min(from.clientX, to.clientX) - area.left}px`;
  modelDialogRubber.style.top = `${Math.min(from.clientY, to.clientY) - area.top}px`;
  modelDialogRubber.style.width = `${Math.abs(to.clientX - from.clientX)}px`;
  modelDialogRubber.style.height = `${Math.abs(to.clientY - from.clientY)}px`;
}

function bindModelFigureView(container) {
  if (!container) return;
  container.addEventListener('wheel', (ev) => {
    if (!modelFigureView) return;
    ev.preventDefault();
    zoomModelFigure(Math.pow(1.0016, ev.deltaY), modelFigureWorld(ev.clientX, ev.clientY));
  }, { passive: false });

  container.addEventListener('contextmenu', (ev) => ev.preventDefault());

  container.addEventListener('pointerdown', (ev) => {
    if (!modelFigureView || (ev.button !== 1 && ev.button !== 2)) return;
    ev.preventDefault();
    const world = modelFigureWorld(ev.clientX, ev.clientY);
    if (!world) return;
    container.setPointerCapture?.(ev.pointerId);
    modelFigureDrag = {
      mode: ev.button === 1 ? 'pan' : 'zoom',
      pointerId: ev.pointerId,
      startWorld: world,
      startView: { ...modelFigureView },
      start: { clientX: ev.clientX, clientY: ev.clientY },
      moved: false,
    };
  });

  container.addEventListener('pointermove', (ev) => {
    const drag = modelFigureDrag;
    if (!drag || drag.pointerId !== ev.pointerId) return;
    if (Math.abs(ev.clientX - drag.start.clientX) > 3 || Math.abs(ev.clientY - drag.start.clientY) > 3) drag.moved = true;
    if (drag.mode === 'pan') {
      // The world point under the cursor stays there, so panning tracks the
      // pointer exactly however the viewBox is currently letterboxed.
      const world = modelFigureWorld(ev.clientX, ev.clientY);
      if (!world) return;
      modelFigureView.x += drag.startWorld.x - world.x;
      modelFigureView.y += drag.startWorld.y - world.y;
      applyModelFigureView();
      return;
    }
    modelFigureRubber(drag.start, { clientX: ev.clientX, clientY: ev.clientY });
  });

  const finish = (ev) => {
    const drag = modelFigureDrag;
    if (!drag || drag.pointerId !== ev.pointerId) return;
    modelFigureDrag = null;
    container.releasePointerCapture?.(ev.pointerId);
    modelFigureRubber(null, null);
    if (drag.mode !== 'zoom') return;
    const world = modelFigureWorld(ev.clientX, ev.clientY);
    if (!world) return;
    // A right-click that did not drag zooms out, as it does on the canvas.
    if (!drag.moved) {
      zoomModelFigure(2, world);
      return;
    }
    zoomModelFigureToRect({
      x: Math.min(drag.startWorld.x, world.x),
      y: Math.min(drag.startWorld.y, world.y),
      w: Math.abs(world.x - drag.startWorld.x),
      h: Math.abs(world.y - drag.startWorld.y),
    });
  };
  container.addEventListener('pointerup', finish);
  container.addEventListener('pointercancel', (ev) => {
    if (modelFigureDrag?.pointerId !== ev.pointerId) return;
    modelFigureDrag = null;
    modelFigureRubber(null, null);
  });
  container.addEventListener('dblclick', () => fitModelFigure());
}

function openSmallSignalModelOverlay() {
  const model = editor.latestSmallSignalModel;
  if (!model?.ok || !modelDialog) return;
  if (modelDialogTitle) {
    const name = editor.currentCircuitName || circuitNameEl.value.trim();
    modelDialogTitle.textContent = name ? `Small-signal model — ${name}` : 'Small-signal model';
  }
  if (modelDialogFigure) {
    // Replace the drawing, not the container: the rubber-band element and the
    // view handlers bound to it outlive every redraw.
    modelDialogFigure.querySelector('svg')?.remove();
    const holder = document.createElement('div');
    holder.innerHTML = svgString(model.circuit, {
      themeInk: true,
      grid: false,
      terminals: false,
      junctions: true,
      background: false,
      emptyHint: false,
    });
    const figure = holder.querySelector('svg');
    if (figure) {
      figure.removeAttribute('width');
      figure.removeAttribute('height');
      figure.setAttribute('role', 'img');
      figure.setAttribute('aria-label', 'Small-signal equivalent circuit');
      modelDialogFigure.prepend(figure);
    }
  }
  if (modelDialogNotes) {
    modelDialogNotes.replaceChildren();
    for (const note of model.notes || []) {
      const item = document.createElement('li');
      item.textContent = note;
      modelDialogNotes.appendChild(item);
    }
    modelDialogNotes.hidden = !(model.notes || []).length;
  }
  if (!modelDialog.open) modelDialog.showModal();
  // The rendered viewBox is the fitted view the figure returns to.
  readModelFigureView();
}

export function installModelFigure() {
  bindModelFigureView(modelDialogFigure);

  analysisModelOpen?.addEventListener('click', openSmallSignalModelOverlay);

  // Escape closes the figure, and closes only the figure: the handler stops the
  // key here so it never reaches the analysis dock's own Escape behind it.
  // Native <dialog> already cancels on Escape; owning it explicitly keeps that
  // true whatever else is listening.
  modelDialog?.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape' || !modelDialog.open) return;
    ev.preventDefault();
    ev.stopPropagation();
    modelDialog.close();
  });

  // A figure this size invites clicking beside it to dismiss it.
  modelDialog?.addEventListener('click', (ev) => {
    if (ev.target === modelDialog) modelDialog.close();
  });

  // Hand the keyboard back to the drawing the figure was covering. The drawing
  // goes; the rubber band and its handlers stay with the container.
  modelDialog?.addEventListener('close', () => {
    modelDialogFigure?.querySelector('svg')?.remove();
    modelFigureView = null;
    modelFigureDrag = null;
    canvasEl.focus();
  });
}
