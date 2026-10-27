#!/usr/bin/env node
/**
 * Prints a Markdown pass/fail and coverage summary from the reports the test runs leave behind:
 *   reports/{unit,integration,e2e}/junit.xml and coverage/coverage-summary.json
 * CI appends the output to $GITHUB_STEP_SUMMARY; locally: `node scripts/test-summary.mjs`.
 * Tests whose title starts with "KNOWN DEFECT:" are expected failures that document a bug in the app.
 * Usage: node scripts/test-summary.mjs [unit|integration|e2e|coverage ...]   (default: everything found)
 */
import { existsSync, readFileSync } from 'node:fs';

const SUITES = {
  unit: { title: 'Unit, API and component tests (Vitest)', file: 'reports/unit/junit.xml' },
  integration: { title: 'Database integration tests (Vitest + Postgres)', file: 'reports/integration/junit.xml' },
  e2e: { title: 'End-to-end tests (Playwright: Chromium, Firefox, WebKit)', file: 'reports/e2e/junit.xml' },
};
const COVERAGE_FILE = 'coverage/coverage-summary.json';
const KNOWN = 'KNOWN DEFECT:';

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Minimal JUnit reader: one entry per <testcase>, with its outcome. */
function readJunit(file) {
  const xml = readFileSync(file, 'utf8');
  const cases = [];
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1];
    const body = m[3] ?? '';
    const name = decode(/\bname="([^"]*)"/.exec(attrs)?.[1] ?? '');
    const suite = decode(/\bclassname="([^"]*)"/.exec(attrs)?.[1] ?? '');
    let status = 'passed';
    if (/<(failure|error)\b/.test(body)) status = 'failed';
    else if (/<skipped\b/.test(body)) status = 'skipped';
    cases.push({ name, suite, status });
  }
  return cases;
}

function suiteSection(key) {
  const { title, file } = SUITES[key];
  if (!existsSync(file)) return `### ${title}\n\n_No report found at \`${file}\`._\n`;
  const cases = readJunit(file);
  const failed = cases.filter((c) => c.status === 'failed');
  const skipped = cases.filter((c) => c.status === 'skipped');
  const known = cases.filter((c) => c.status === 'passed' && c.name.includes(KNOWN));
  const passed = cases.length - failed.length - skipped.length - known.length;
  const icon = failed.length ? '❌' : '✅';
  const lines = [
    `### ${icon} ${title}`,
    '',
    '| Total | Passed | Failed | Skipped | Documented defects (expected to fail) |',
    '|---:|---:|---:|---:|---:|',
    `| ${cases.length} | ${passed} | ${failed.length} | ${skipped.length} | ${known.length} |`,
    '',
  ];
  if (failed.length) {
    lines.push('**Failing tests**', '');
    failed.slice(0, 30).forEach((c) => lines.push(`- \`${c.suite}\` › ${c.name}`));
    if (failed.length > 30) lines.push(`- …and ${failed.length - 30} more (see the HTML report artifact)`);
    lines.push('');
  }
  if (known.length) {
    lines.push('<details><summary>Documented defects (tests that are expected to fail)</summary>', '');
    known.forEach((c) => lines.push(`- \`${c.suite}\` › ${c.name.replace(/^.*?KNOWN DEFECT:\s*/, '')}`));
    lines.push('', '</details>', '');
  }
  return lines.join('\n');
}

function coverageSection() {
  if (!existsSync(COVERAGE_FILE)) return `### Coverage\n\n_No report found at \`${COVERAGE_FILE}\`._\n`;
  const summary = JSON.parse(readFileSync(COVERAGE_FILE, 'utf8'));
  const metrics = ['statements', 'branches', 'functions', 'lines'];
  const areas = [['src/lib', '/src/lib/'], ['src/app/api', '/src/app/api/'], ['src/components', '/src/components/']];
  const totals = {};
  Object.entries(summary).forEach(([file, data]) => {
    if (file === 'total') return;
    const area = areas.find(([, needle]) => file.includes(needle))?.[0] ?? 'other (contexts, hooks, middleware)';
    totals[area] ??= Object.fromEntries(metrics.map((k) => [k, { covered: 0, total: 0 }]));
    metrics.forEach((k) => {
      totals[area][k].covered += data[k].covered;
      totals[area][k].total += data[k].total;
    });
  });
  const pct = ({ covered, total }) => (total ? `${((100 * covered) / total).toFixed(1)}%` : 'n/a');
  const lines = [
    '### Coverage (v8)',
    '',
    '| Area | Statements | Branches | Functions | Lines |',
    '|---|---:|---:|---:|---:|',
  ];
  [...areas.map(([a]) => a), 'other (contexts, hooks, middleware)'].forEach((area) => {
    if (totals[area]) lines.push(`| ${area} | ${metrics.map((k) => pct(totals[area][k])).join(' | ')} |`);
  });
  lines.push(`| **All measured code** | ${metrics.map((k) => `**${summary.total[k].pct}%**`).join(' | ')} |`, '');
  return lines.join('\n');
}

const wanted = process.argv.slice(2);
const parts = wanted.length ? wanted : [...Object.keys(SUITES), 'coverage'];
const out = parts.map((part) => (part === 'coverage' ? coverageSection() : suiteSection(part)));
console.log(out.join('\n'));
