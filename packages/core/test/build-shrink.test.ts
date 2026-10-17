import { describe, expect, it } from 'vitest';
import { joinShaderLines, lineMap, minifyGlsl, minifyShaders, renameGlNames } from '../../../scripts/build-shrink';
import rendererSource from '../src/gl/renderer.ts?raw';
import heatmapSource from '../src/gl/heatmap-program.ts?raw';

/** GLSL tokens of `source`, comments and whitespace dropped; preprocessor lines kept whole. */
function tokens(source: string): string[] {
  const out: string[] = [];
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
  for (const line of code.split(/\r?\n/)) {
    const text = line.replace(/\/\/.*$/, '').trim();
    if (text.startsWith('#')) {
      out.push(text.replace(/\s+/g, ' '));
      continue;
    }
    const pattern = /(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?[uUfF]?|\w+|<<=|>>=|\+\+|--|<<|>>|<=|>=|==|!=|&&|\|\||\^\^|[-+*/%&|^]=|\S/g;
    out.push(...(text.match(pattern) ?? []));
  }
  return out;
}

/** Names on the lines that declare inputs, outputs and uniforms. */
function interfaceNames(source: string): Set<string> {
  const lines = source.split(/\r?\n/).filter((line) => /^\s*(?:layout\(|flat\s|uniform\s|in\s|out\s)/.test(line));
  return new Set(lines.flatMap((line) => line.replace(/\/\/.*$/, '').match(/\b[A-Za-z_]\w*/g) ?? []));
}

/**
 * `small` is `original` with numbers written differently but equal, and with names the shader
 * declares itself consistently replaced by distinct shorter ones; every other token is unchanged.
 */
function expectSameProgram(small: string[], original: string[], source: string): void {
  expect(small.length).toBe(original.length);
  const shared = interfaceNames(source);
  const renamed = new Map<string, string>();
  const used = new Map<string, string>();
  // Names in scope, so not fields or swizzles after a dot.
  const names = new Set(original.filter((token, i) => /^[A-Za-z_]/.test(token) && original[i - 1] !== '.'));
  original.forEach((token, i) => {
    const out = small[i]!;
    if (/^[\d.]/.test(token)) {
      expect(Number(out.replace(/[uUfF]$/, ''))).toBe(Number(token.replace(/[uUfF]$/, '')));
    } else if (out !== token) {
      expect(token).toMatch(/^[A-Za-z_]\w*$/);
      expect(shared.has(token)).toBe(false);
      expect(token).not.toBe('main');
      expect(out.length).toBeLessThan(token.length);
      expect(renamed.get(token) ?? out).toBe(out);
      expect(used.get(out) ?? token).toBe(token);
      expect(names.has(out)).toBe(false);
      renamed.set(token, out);
      used.set(out, token);
    }
  });
}

/** The shader sources in a module, as written. */
const shaders = (source: string) => [...source.matchAll(/`(#version 300 es\r?\n[^`$\\]*)`/g)].map((m) => m[1]!);
const all = [...shaders(rendererSource), ...shaders(heatmapSource)];

describe('GLSL minification', () => {
  it('finds every shader in the GL modules', () => {
    expect(minifyShaders(rendererSource).count).toBe(rendererSource.split('#version 300 es').length - 1);
    expect(minifyShaders(heatmapSource).count).toBe(heatmapSource.split('#version 300 es').length - 1);
    expect(all.length).toBeGreaterThanOrEqual(14);
  });

  it('keeps the token sequence, line count and directive lines of each shader', () => {
    for (const source of all) {
      const small = minifyGlsl(source);
      expectSameProgram(tokens(small), tokens(source), source);
      expect(small.split('\n').length).toBe(source.split(/\r?\n/).length);
      expect(small.startsWith('#version 300 es\n')).toBe(true);
      expect(small.length).toBeLessThan(source.length);
    }
  });

  it('keeps spaces that separate tokens', () => {
    expect(minifyGlsl('  float a = b - -c;  // note\n  x = y / *p;')).toBe('float a=b- -c;\nx=y/ *p;');
    expect(minifyGlsl('a + +b; c < = d; /* block\n comment */ uniform  vec2 u;')).toBe('a+ +b;c< =d;\nuniform vec2 u;');
    expect(minifyGlsl('#define  N 4\nvoid main() { }')).toBe('#define N 4\nvoid main(){}');
  });

  it('shortens float literals and the names a shader declares, not its inputs, outputs or uniforms', () => {
    const source =
      'uniform float u_scale;\nin vec2 v_pos;\nfloat twice(float value) { return value * 2.0; }\nvoid main() { float scaled = twice(u_scale) * 0.5; x = scaled + v_pos.x; }';
    expect(minifyGlsl(source)).toBe(
      'uniform float u_scale;\nin vec2 v_pos;\nfloat b(float c){return c*2.;}\nvoid main(){float a=b(u_scale)*.5;x=a+v_pos.x;}',
    );
    expect(minifyGlsl('#define N 4\nfloat value = 1.0;')).toBe('#define N 4\nfloat value=1.;');
  });

  it('joins shader lines except around directives, and maps each output line to its source line', () => {
    const code = 'const a = 1;\nconst s = `#version 300 es\nprecision highp float;\n\nfloat x=1.;\n#define N 2\nfloat y=x\n+ +x;`;\nconst b = 2;';
    const joined = joinShaderLines(code);
    expect(joined.code).toBe('const a = 1;\nconst s = `#version 300 es\nprecision highp float;float x=1.;\n#define N 2\nfloat y=x+ +x;`;\nconst b = 2;');
    expect(joined.lines).toEqual([0, 1, 2, 5, 6, 8]);
    expect(lineMap('m.ts', joined.lines)).toEqual({ version: 3, sources: ['m.ts'], names: [], mappings: 'AAAA;AACA;AACA;AAGA;AACA;AAEA' });
    for (const module of [rendererSource, heatmapSource]) {
      const small = minifyShaders(module).code;
      const result = joinShaderLines(small);
      // The same code with fewer line breaks: every line still starts where its source line does.
      const out = result.code.split('\n');
      const source = small.split('\n');
      expect(out.length).toBe(result.lines.length);
      out.forEach((line, i) => {
        const from = source[result.lines[i]!]!;
        expect(line.slice(0, from.length)).toBe(from.slice(0, line.length));
      });
      const before = shaders(small);
      const after = shaders(result.code);
      expect(after.length).toBe(before.length);
      after.forEach((shader, i) => expect(tokens(shader)).toEqual(tokens(before[i]!)));
    }
  });

  it('shortens the uniform, attribute, varying and output names a GL module shares with its shaders', () => {
    const source = "gl.uniform1f(loc.u_x, 1); const names = ['u_x']; const fs = `in vec4 v_color; out vec4 outColor; void main() { outColor = v_color; }`;";
    expect(renameGlNames(source)).toBe(
      "gl.uniform1f(loc.ab, 1); const names = ['ab']; const fs = `in vec4 ac; out vec4 aa; void main() { aa = ac; }`;",
    );
    for (const module of [rendererSource, heatmapSource]) {
      const input = minifyShaders(module).code;
      const output = renameGlNames(input);
      expect(output).not.toMatch(/\b(?:[uav]_[A-Za-z]\w*|outColor)\b/);
      // Every new name stands for one old name everywhere, so mapping back restores the module.
      const known = new Set(input.match(/[A-Za-z_$][\w$]*/g));
      const added = (output.match(/[A-Za-z_$][\w$]*/g) ?? []).filter((name) => !known.has(name));
      const replaced = input.match(/\b(?:[uav]_[A-Za-z]\w*|outColor)\b/g) ?? [];
      expect(added.length).toBe(replaced.length);
      const back = new Map<string, string>();
      added.forEach((name, i) => {
        expect(back.get(name) ?? replaced[i]).toBe(replaced[i]);
        back.set(name, replaced[i]!);
      });
      expect(new Set(back.values()).size).toBe(back.size);
      expect(output.replace(/[A-Za-z_$][\w$]*/g, (name) => back.get(name) ?? name)).toBe(input);
    }
  });
});
