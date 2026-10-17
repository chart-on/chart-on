/**
 * Build settings that shrink the published bundles without changing what they do. Shared by the
 * package Vite configs; `packages/core/test/build-shrink.test.ts` checks the GLSL transform.
 */
import type { Plugin } from 'vite';

/**
 * Output options for an ES library build. Vite minifies ES library output but keeps its whitespace,
 * so pure annotations survive for the consumer's tree shaking. The minifier keeps those annotations
 * when it removes whitespace too, so the shipped files drop the indentation and line breaks.
 */
export const libraryOutput = { minify: { codegen: { removeWhitespace: true } } } as const;

/** A shader source in a template literal without substitutions or escapes. */
const SHADER = /`(#version 300 es\r?\n[^`$\\]*)`/g;
const WORD = /[\w.]/;
const OPERATOR = /[-+*/%<>=!&|^]/;

/** A type followed by the name it declares: a variable, a parameter or a function. */
const DECLARATION = /\b(?:void|bool|int|uint|float|[biu]?vec[234]|mat[234](?:x[234])?)\s+([A-Za-z_]\w*)/g;
/** A line declaring inputs, outputs or uniforms: names shared with the other stage and the engine. */
const INTERFACE = /^(?:layout\([^)]*\)\s*)?(?:(?:flat|smooth|centroid)\s+)?(?:uniform|in|out)\s/;
/** An identifier, not a field or swizzle after a dot. */
const NAME = /(?<![\w.])[A-Za-z_]\w*/g;
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Short names that are GLSL (and JavaScript) keywords. */
const KEYWORDS = new Set(['do', 'if', 'in']);

/**
 * GLSL `source` without comments, indentation and the spaces the grammar does not need, with
 * float literals in their shortest form and its own names (locals, parameters and functions
 * other than `main`) shortened. Inputs, outputs and uniforms keep their names. Line breaks stay,
 * so preprocessor directives keep their own lines and source maps keep their lines.
 */
export function minifyGlsl(source: string): string {
  const noBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ''));
  const lines = noBlocks.split(/\r?\n/).map((line) => {
    const code = line.replace(/\/\/.*$/, '').trim().replace(/\s+/g, ' ');
    if (code.startsWith('#')) return code;
    let out = '';
    for (let i = 0; i < code.length; i++) {
      const c = code[i]!;
      if (c === ' ') {
        const before = out[out.length - 1] ?? '';
        const after = code[i + 1] ?? '';
        const joins = (WORD.test(before) && WORD.test(after)) || (OPERATOR.test(before) && OPERATOR.test(after));
        if (!joins) continue;
      }
      out += c;
    }
    // `2.0` to `2.` and `0.5` to `.5`.
    return out.replace(/(?<![\w.])(\d+)\.0+(?![\w.])/g, '$1.').replace(/(?<![\w.])0\.(?=\d)/g, '.');
  });
  return renameLocals(lines).join('\n');
}

/** `lines` with the names the shader declares itself shortened, most used first; unchanged when a macro could hide a use. */
function renameLocals(lines: string[]): string[] {
  if (lines.some((line) => line.startsWith('#') && !line.startsWith('#version'))) return lines;
  const shared = new Set<string>();
  const own = new Set<string>();
  for (const line of lines) {
    for (const [, name] of line.matchAll(DECLARATION)) (INTERFACE.test(line) ? shared : own).add(name!);
  }
  const uses = new Map<string, number>();
  for (const line of lines) for (const [name] of line.matchAll(NAME)) uses.set(name, (uses.get(name) ?? 0) + 1);
  const names = [...own].filter((name) => name !== 'main' && name.length > 1 && !shared.has(name));
  names.sort((a, b) => uses.get(b)! * b.length - uses.get(a)! * a.length);
  const short = new Map<string, string>();
  let next = 0;
  for (const name of names) {
    let candidate: string;
    do candidate = shortName(next++);
    while (uses.has(candidate) || KEYWORDS.has(candidate));
    if (candidate.length < name.length) short.set(name, candidate);
    else next--;
  }
  return lines.map((line) => (line.startsWith('#') ? line : line.replace(NAME, (name) => short.get(name) ?? name)));
}

/** The `i`th short name: one letter, then two. */
function shortName(i: number): string {
  return i < LETTERS.length ? LETTERS[i]! : LETTERS[Math.floor(i / LETTERS.length) - 1]! + LETTERS[i % LETTERS.length]!;
}

/** Uniform, attribute and varying names (`u_`, `a_`, `v_`) and the fragment output, which a GL module's code and shaders share. */
const GL_NAME = /\b(?:[uav]_[A-Za-z]\w*|outColor)\b/g;

/**
 * `code` of a GL module with its uniform, attribute, varying and fragment
 * output names shortened everywhere they appear: in its shaders, in the
 * uniform lookups by name and in the properties that hold the locations.
 * Attributes have fixed locations and varyings match by name between the
 * stages, so every use changes together. The new names are two letters that
 * appear nowhere in `code`.
 */
export function renameGlNames(code: string): string {
  const names = [...new Set(code.match(GL_NAME))].sort();
  const taken = new Set(code.match(/[A-Za-z_$][\w$]*/g));
  const short = new Map<string, string>();
  let next = LETTERS.length;
  for (const name of names) {
    let candidate: string;
    do candidate = shortName(next++);
    while (taken.has(candidate) || KEYWORDS.has(candidate));
    short.set(name, candidate);
  }
  return code.replace(GL_NAME, (name) => short.get(name)!);
}

/** Replace every shader source in `code` with its minified form; `count` is how many were found. */
export function minifyShaders(code: string): { code: string; count: number } {
  let count = 0;
  const next = code.replace(SHADER, (_, body: string) => {
    count++;
    return `\`${minifyGlsl(body)}\``;
  });
  return { code: next, count };
}

/**
 * `code` with the line breaks inside its shader sources (minified, so without
 * comments) dropped, except around preprocessor directives, which keep lines
 * of their own. `lines[i]` is the line of `code` that output line `i` starts on.
 */
export function joinShaderLines(code: string): { code: string; lines: number[] } {
  const lines: number[] = [0];
  let out = '';
  let line = 0;
  let last = 0;
  const copy = (text: string) => {
    for (const c of text) {
      out += c;
      if (c === '\n') lines.push(++line);
    }
  };
  for (const m of code.matchAll(SHADER)) {
    copy(code.slice(last, m.index + 1));
    const start = line;
    const body = m[1]!.split(/\r?\n/);
    let breakNext = false;
    body.forEach((text, i) => {
      if (text === '') return;
      const directive = text.startsWith('#');
      if (i > 0 && (directive || breakNext)) {
        out += '\n';
        lines.push(start + i);
      } else if (i > 0) {
        const before = out[out.length - 1]!;
        const after = text[0]!;
        if ((WORD.test(before) && WORD.test(after)) || (OPERATOR.test(before) && OPERATOR.test(after))) out += ' ';
      }
      out += text;
      breakNext = directive;
    });
    line = start + body.length - 1;
    last = m.index + m[0].length - 1;
  }
  copy(code.slice(last));
  return { code: out, lines };
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** One source map segment value as base64 VLQ. */
function vlq(value: number): string {
  let v = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = '';
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v > 0) digit |= 32;
    out += BASE64[digit];
  } while (v > 0);
  return out;
}

/** A source map of `source` that maps each output line to the start of its line `lines[i]`. */
export function lineMap(source: string, lines: readonly number[]): { version: 3; sources: string[]; names: string[]; mappings: string } {
  const mappings = lines.map((line, i) => `AA${vlq(line - (i > 0 ? lines[i - 1]! : 0))}A`).join(';');
  return { version: 3, sources: [source], names: [], mappings };
}

/** Vite plugin: minify the GLSL shader sources embedded in the engine at build time, and the names GL modules share with them. */
export function glslMinify(): Plugin {
  return {
    name: 'charton-glsl-minify',
    transform(code, id) {
      if (!code.includes('#version 300 es')) return null;
      const result = minifyShaders(code);
      if (result.count === 0) return null;
      const joined = joinShaderLines(renameGlNames(result.code));
      return { code: joined.code, map: lineMap(id, joined.lines) };
    },
  };
}
