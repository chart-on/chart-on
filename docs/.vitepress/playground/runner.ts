/**
 * Runs playground code: TypeScript in, a chart in the given element out.
 * The code has the shape of a docs example, a default export
 * `(el, { dark }) => cleanUp`, and imports the packages by name.
 */
import type * as TypeScript from 'typescript';
import * as core from '@chart-on/core';
import * as ui from '@chart-on/ui';
import * as indicators from '@chart-on/indicators';
import * as ta from '@chart-on/ta';
import '@chart-on/ui/style.css';
import * as sampleData from '../../examples/sample-data';
import type { ExampleContext } from '../../examples/types';

/** A syntax error in the code, with its 1-based position. */
export class PlaygroundSyntaxError extends Error {
  constructor(message: string, readonly line: number, readonly column: number) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = 'SyntaxError';
  }
}

/** The code as JavaScript that loads its imports through `require`. Throws a `PlaygroundSyntaxError`. */
export function transpile(ts: typeof TypeScript, source: string): string {
  const { outputText, diagnostics = [] } = ts.transpileModule(source, {
    fileName: 'playground.ts',
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, sourceMap: false },
  });
  const first = diagnostics.find((d) => d.category === ts.DiagnosticCategory.Error);
  if (first) {
    const text = ts.flattenDiagnosticMessageText(first.messageText, '\n');
    const { line, character } = first.file ? first.file.getLineAndCharacterOfPosition(first.start ?? 0) : { line: 0, character: 0 };
    throw new PlaygroundSyntaxError(text, line + 1, character + 1);
  }
  return outputText;
}

interface Destroyable {
  destroy(): void;
}

/**
 * `make` with each result remembered in `live` and its `destroy` made safe
 * to call twice: the code's clean-up may have destroyed it already.
 */
function tracked<A extends unknown[], T extends Destroyable>(make: (...args: A) => T, live: Set<Destroyable>): (...args: A) => T {
  return (...args) => {
    const made = make(...args);
    const destroy = made.destroy.bind(made);
    made.destroy = () => {
      if (!live.delete(made)) return;
      destroy();
    };
    live.add(made);
    return made;
  };
}

/** What the code can import: the packages, and the docs examples' helpers so gallery code runs unchanged. */
function modulesFor(live: Set<Destroyable>): Record<string, unknown> {
  return {
    '@chart-on/core': { ...core, createChart: tracked(core.createChart, live) },
    '@chart-on/ui': { ...ui, createChartShell: tracked(ui.createChartShell, live) },
    // Loaded with the playground already.
    '@chart-on/ui/style.css': {},
    '@chart-on/indicators': indicators,
    '@chart-on/ta': ta,
    './sample-data': sampleData,
    // Types only; nothing to load.
    './types': {},
  };
}

/** The names the code can import. */
export const PLAYGROUND_IMPORTS = Object.keys(modulesFor(new Set()));

/**
 * Runs transpiled code into `el` and returns its clean-up, which calls the
 * code's own and then destroys any chart or shell it left. Throws what the
 * code throws, after cleaning up what it made before that.
 */
export function run(js: string, el: HTMLElement, context: ExampleContext): () => void {
  const live = new Set<Destroyable>();
  const modules = modulesFor(live);
  const require = (name: string): unknown => {
    if (!Object.hasOwn(modules, name)) throw new Error(`Cannot import "${name}" in the playground. Available: ${PLAYGROUND_IMPORTS.join(', ')}`);
    return modules[name];
  };
  const cleanUp = (own: unknown) => {
    try {
      if (typeof own === 'function') own();
    } finally {
      for (const made of [...live]) made.destroy();
      el.replaceChildren();
    }
  };
  const module: { exports: Record<string, unknown> } = { exports: {} };
  try {
    // The playground runs code the reader wrote or opened a link to, on purpose; the library itself never evaluates code.
    new Function('require', 'module', 'exports', `${js}\n//# sourceURL=playground.ts`)(require, module, module.exports);
    const mount = module.exports.default;
    if (typeof mount !== 'function') throw new Error('The code needs a default export: a function (el, { dark }) that returns its clean-up.');
    const own: unknown = mount(el, context);
    return () => cleanUp(own);
  } catch (error) {
    cleanUp(null);
    throw error;
  }
}

/** One line for the error panel: the `ChartError` code first when there is one, then the message and its cause. */
export function describeError(error: unknown): string {
  if (error instanceof core.ChartError) {
    const cause = error.cause instanceof Error ? ` (cause: ${error.cause.message})` : '';
    return `ChartError [${error.code}]: ${error.message}${cause}`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return `Thrown: ${String(error)}`;
}
