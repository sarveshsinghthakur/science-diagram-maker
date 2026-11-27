import { validateSVG } from '../src/lib/validator';

/**
 * A tiny self-contained test suite for the SVG validator.
 * Run with: npx tsx scripts/test-validator.ts
 */

const VALID_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120">
  <title>Parts of a circle</title>
  <circle cx="100" cy="60" r="50" fill="#e0f2fe" stroke="#0369a1" stroke-width="3">
    <animate attributeName="r" values="50;45;50" dur="4s" repeatCount="indefinite" />
  </circle>
  <line x1="100" y1="60" x2="150" y2="60" stroke="#dc2626" stroke-width="3" />
  <text x="100" y="112" font-size="12" text-anchor="middle">Centre</text>
  <text x="160" y="56" font-size="12">Radius</text>
  <text x="100" y="20" font-size="12" text-anchor="middle">Circumference</text>
</svg>`;

const MISSING_VIEWBOX = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120">
  <title>No viewBox</title>
  <circle cx="10" cy="10" r="5" />
  <text x="10" y="30">A</text>
  <text x="10" y="50">B</text>
  <text x="10" y="70">C</text>
  <animate attributeName="x" values="0;10" dur="2s" />
</svg>`;

const OUTSIDE_VIEWBOX = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <title>Draws outside</title>
  <rect x="80" y="10" width="60" height="40" fill="red" />
  <text x="10" y="30">A</text>
  <text x="10" y="50">B</text>
  <text x="10" y="70">C</text>
  <animate attributeName="x" values="0;10" dur="2s" />
</svg>`;

const TOO_FEW_LABELS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <title>Only two labels</title>
  <circle cx="50" cy="50" r="30" />
  <text x="10" y="30">A</text>
  <text x="10" y="50">B</text>
  <animate attributeName="x" values="0;10" dur="2s" />
</svg>`;

const NO_ANIMATION = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <title>Static</title>
  <circle cx="50" cy="50" r="30" />
  <text x="10" y="30">A</text>
  <text x="10" y="50">B</text>
  <text x="10" y="70">C</text>
</svg>`;

const WITH_SCRIPT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <title>Malicious</title>
  <script>alert('xss')</script>
  <circle cx="50" cy="50" r="30" />
  <text x="10" y="30">A</text>
  <text x="10" y="50">B</text>
  <text x="10" y="70">C</text>
  <animate attributeName="x" values="0;10" dur="2s" />
</svg>`;

const BROKEN_XML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <title>Broken
  <circle cx="50" cy="50" r="30" />
</svg>`;

const WITH_EVENT_HANDLER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <title>Inline handler</title>
  <circle cx="50" cy="50" r="30" onclick="alert('xss')" />
  <text x="10" y="30">A</text>
  <text x="10" y="50">B</text>
  <text x="10" y="70">C</text>
  <animate attributeName="x" values="0;10" dur="2s" />
</svg>`;

const WITH_JAVASCRIPT_URL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <title>javascript: URL</title>
  <a href="javascript:alert('xss')"><circle cx="50" cy="50" r="30" /></a>
  <text x="10" y="30">A</text>
  <text x="10" y="50">B</text>
  <text x="10" y="70">C</text>
  <animate attributeName="x" values="0;10" dur="2s" />
</svg>`;

const WITH_FOREIGN_OBJECT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <title>foreignObject</title>
  <foreignObject width="50" height="50"><div xmlns="http://www.w3.org/1999/xhtml">html</div></foreignObject>
  <text x="10" y="30">A</text>
  <text x="10" y="50">B</text>
  <text x="10" y="70">C</text>
  <animate attributeName="x" values="0;10" dur="2s" />
</svg>`;

const CSS_ANIMATION = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <title>CSS animation</title>
  <style>@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } .spin { animation: spin 2s linear infinite; }</style>
  <circle class="spin" cx="50" cy="50" r="30" />
  <text x="10" y="30">A</text>
  <text x="10" y="50">B</text>
  <text x="10" y="70">C</text>
</svg>`;

const NOT_AN_SVG = `<div><p>This is not an SVG at all.</p></div>`;

const CASES: Array<{ name: string; svg: string; expected: boolean; expectedCheck?: string }> = [
  { name: 'valid animated SVG', svg: VALID_SVG, expected: true },
  { name: 'missing viewBox', svg: MISSING_VIEWBOX, expected: false, expectedCheck: 'withinViewBox' },
  { name: 'element outside viewBox', svg: OUTSIDE_VIEWBOX, expected: false, expectedCheck: 'withinViewBox' },
  { name: 'fewer than 3 labels', svg: TOO_FEW_LABELS, expected: false, expectedCheck: 'hasTitleAndLabels' },
  { name: 'no animation', svg: NO_ANIMATION, expected: false, expectedCheck: 'hasAnimation' },
  { name: 'CSS animation instead of SMIL', svg: CSS_ANIMATION, expected: true },
  { name: 'contains a script', svg: WITH_SCRIPT, expected: false, expectedCheck: 'noScripts' },
  { name: 'inline on* event handler', svg: WITH_EVENT_HANDLER, expected: false, expectedCheck: 'noScripts' },
  { name: 'javascript: URL', svg: WITH_JAVASCRIPT_URL, expected: false, expectedCheck: 'noScripts' },
  { name: 'contains a foreignObject', svg: WITH_FOREIGN_OBJECT, expected: false, expectedCheck: 'noScripts' },
  { name: 'malformed XML', svg: BROKEN_XML, expected: false, expectedCheck: 'isParsable' },
  { name: 'not an SVG document', svg: NOT_AN_SVG, expected: false, expectedCheck: 'isParsable' },
];

let failures = 0;

for (const testCase of CASES) {
  const result = validateSVG(testCase.svg);
  const ok = result.valid === testCase.expected;
  const checkOk =
    !testCase.expectedCheck || result.checks[testCase.expectedCheck as keyof typeof result.checks] === false;

  if (!ok || !checkOk) failures++;

  const status = ok && checkOk ? 'PASS' : 'FAIL';
  console.log(
    `${status}  ${testCase.name.padEnd(28)} valid=${String(result.valid).padEnd(5)} checks=${JSON.stringify(result.checks)}`
  );
  if (result.error) console.log(`      reason: ${result.error}`);
}

console.log(`\n${CASES.length - failures}/${CASES.length} validator tests passed.`);
if (failures > 0) process.exit(1);
