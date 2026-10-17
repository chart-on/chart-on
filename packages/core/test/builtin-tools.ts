import type { DrawingManager } from '../src/drawing/manager';
import { builtinTools } from '../src/drawing/tools';

/** `manager` with every built-in tool registered, as a chart with the `drawingTools()` plugin has. */
export function withBuiltinTools<M extends DrawingManager>(manager: M): M {
  for (const tool of builtinTools) manager.register(tool);
  return manager;
}
