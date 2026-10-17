// Compares runs of `pnpm bench` (saved with `--reporter=json --outputFile=<file>`) and fails when
// a benchmark's median time grew by more than the threshold. CI runs the same benchmarks against
// the base branch's build and the pull request's build, alternating, on one machine, then calls
// this.
//
//   node scripts/compare-bench.mjs --base a.json [--base b.json] --head c.json [--head d.json]
//                                  [--threshold 0.25]
//
// With several runs per side, each benchmark keeps its fastest median: noise only ever slows a
// run down. Prints a Markdown table, also to the job summary when `GITHUB_STEP_SUMMARY` is set.
// Without a readable base run (the base branch cannot run these benchmarks) it reports the head
// numbers only and passes.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    base: { type: 'string', multiple: true, default: [] },
    head: { type: 'string', multiple: true, default: [] },
    threshold: { type: 'string', default: '0.25' },
  },
});
const threshold = Number(values.threshold);
if (values.head.length === 0 || !(threshold > 0)) {
  console.error('usage: node scripts/compare-bench.mjs --base a.json --head b.json [--threshold 0.25]');
  process.exit(2);
}

/** Fastest median time in ms per benchmark across the runs, keyed `<test> > <benchmark>`; null without results. */
function medians(paths) {
  const out = new Map();
  for (const path of paths) {
    if (!existsSync(path)) continue;
    let report;
    try {
      report = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      continue;
    }
    for (const file of report.testResults ?? []) {
      for (const test of file.assertionResults ?? []) {
        for (const group of test.benchmarks ?? []) {
          for (const task of group.tasks ?? []) {
            const median = task.latency?.p50;
            const name = `${group.name} > ${task.name}`;
            if (Number.isFinite(median)) out.set(name, Math.min(median, out.get(name) ?? Infinity));
          }
        }
      }
    }
  }
  return out.size > 0 ? out : null;
}

const head = medians(values.head);
if (!head) {
  console.error(`No benchmark results in ${values.head.join(', ')}.`);
  process.exit(1);
}
const base = medians(values.base);
const ms = (v) => `${v < 1 ? v.toFixed(3) : v.toFixed(1)} ms`;

const lines = base
  ? ['| Benchmark | Base median | Head median | Change |', '| --- | ---: | ---: | ---: |']
  : ['| Benchmark | Median |', '| --- | ---: |'];
const regressions = [];
for (const [name, time] of head) {
  if (!base) {
    lines.push(`| ${name} | ${ms(time)} |`);
    continue;
  }
  const before = base.get(name);
  if (before === undefined) {
    lines.push(`| ${name} | new | ${ms(time)} | |`);
    continue;
  }
  const change = time / before - 1;
  const flag = change > threshold ? ' (regression)' : '';
  if (flag) regressions.push(name);
  lines.push(`| ${name} | ${ms(before)} | ${ms(time)} | ${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}%${flag} |`);
}

const verdict = !base
  ? 'No base run to compare with; head numbers only.'
  : regressions.length > 0
    ? `${regressions.length} benchmark(s) more than ${threshold * 100}% slower than the base branch.`
    : `No benchmark more than ${threshold * 100}% slower than the base branch.`;
const report = `### Benchmarks\n\nCPU-side work under Node, not GPU time. ${verdict}\n\n${lines.join('\n')}\n`;
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
if (regressions.length > 0) process.exit(1);
