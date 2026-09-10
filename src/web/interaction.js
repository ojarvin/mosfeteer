import { snap } from '../core/grid.js';

export function worldAndCursorFromClient(clientX, clientY, rect, view) {
  const world = {
    x: view.x + ((clientX - rect.left) / rect.width) * view.w,
    y: view.y + ((clientY - rect.top) / rect.height) * view.h,
  };
  return { world, cursor: { x: snap(world.x), y: snap(world.y) } };
}
