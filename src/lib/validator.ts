import { ValidationResult } from './constants';
import { parseSvgDocument, queryAll, queryOne, tagNameOf } from './svg-dom';
import type { Document, Element } from './svg-dom';

/**
 * The 4 mandatory checks + 1 custom security check.
 *
 * 1. isParsable         - the SVG is well-formed XML and has an <svg> root.
 * 2. withinViewBox      - nothing is drawn outside the viewBox (geometric bounds check).
 * 3. hasTitleAndLabels  - has a <title> and at least 3 <text> labels.
 * 4. hasAnimation       - has SMIL animation or a CSS @keyframes/animation rule.
 * 5. noScripts (custom) - no <script> elements, no on* event handlers, no javascript: URLs.
 *
 * The DOM comes from `@xmldom/xmldom`, a pure CommonJS XML parser with no
 * dependencies. It was chosen over `jsdom` because `jsdom` pulls in an
 * ESM-only transitive dependency (`@exodus/bytes`) that cannot be loaded by
 * the CommonJS `require()` used inside a Vercel serverless function.
 */

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const EPSILON = 0.5; // tolerance in user units, avoids false positives from rounding

function parseNumber(value: string | null): number {
  if (value === null) return NaN;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? NaN : parsed;
}

/** Extracts every numeric coordinate pair from a path `d` attribute. */
function pathPoints(d: string): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  let currentX = 0;
  let currentY = 0;

  // Tokenise the path into commands and numbers.
  const tokenRegex = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi;
  let match: RegExpExecArray | null;
  const tokens: Array<string | number> = [];

  while ((match = tokenRegex.exec(d)) !== null) {
    tokens.push(match[1] ? match[1].toUpperCase() : Number(match[2]));
  }

  const isCommand = (token: string | number): token is string => typeof token === 'string';
  let index = 0;

  const take = (): number => {
    const token = tokens[index++];
    return typeof token === 'number' ? token : NaN;
  };

  while (index < tokens.length) {
    const command = tokens[index];
    if (!isCommand(command)) {
      index++;
      continue;
    }
    index++;

    const relative = command === command.toLowerCase();
    const upper = command.toUpperCase();

    if (upper === 'Z') {
      currentX = 0;
      currentY = 0;
      continue;
    }

    if (upper === 'M' || upper === 'L' || upper === 'T') {
      while (index < tokens.length && typeof tokens[index] === 'number') {
        const x = take();
        const y = take();
        currentX = relative ? currentX + x : x;
        currentY = relative ? currentY + y : y;
        points.push({ x: currentX, y: currentY });
      }
      continue;
    }

    if (upper === 'H') {
      while (index < tokens.length && typeof tokens[index] === 'number') {
        currentX = relative ? currentX + take() : take();
        points.push({ x: currentX, y: currentY });
      }
      continue;
    }

    if (upper === 'V') {
      while (index < tokens.length && typeof tokens[index] === 'number') {
        currentY = relative ? currentY + take() : take();
        points.push({ x: currentX, y: currentY });
      }
      continue;
    }

    if (upper === 'C' || upper === 'S' || upper === 'Q') {
      const coordinateCount = upper === 'C' ? 6 : upper === 'S' ? 4 : 4;
      while (index < tokens.length && typeof tokens[index] === 'number') {
        const chunk: number[] = [];
        for (let c = 0; c < coordinateCount; c++) chunk.push(take());
        const x = chunk[chunk.length - 2];
        const y = chunk[chunk.length - 1];
        currentX = relative ? currentX + x : x;
        currentY = relative ? currentY + y : y;
        points.push({ x: currentX, y: currentY });
      }
      continue;
    }

    if (upper === 'A') {
      while (index < tokens.length && typeof tokens[index] === 'number') {
        const rx = take();
        const ry = take();
        const rotation = take();
        const largeArc = take();
        const sweep = take();
        const x = take();
        const y = take();
        currentX = relative ? currentX + x : x;
        currentY = relative ? currentY + y : y;
        // Approximate the arc with its two endpoints plus the radii to stay conservative.
        points.push({ x: currentX - rx, y: currentY });
        points.push({ x: currentX + rx, y: currentY });
        points.push({ x: currentX, y: currentY - ry });
        points.push({ x: currentX, y: currentY + ry });
        void rotation;
        void largeArc;
        void sweep;
      }
      continue;
    }

    // Unknown command: skip it.
    index++;
  }

  return points;
}

/** Computes an approximate bounding box for a drawable SVG element. */
function elementBox(element: Element): Box | null {
  const tag = tagNameOf(element);
  const get = (name: string): number => parseNumber(element.getAttribute(name));

  switch (tag) {
    case 'rect': {
      const x = Number.isNaN(get('x')) ? 0 : get('x');
      const y = Number.isNaN(get('y')) ? 0 : get('y');
      const w = get('width');
      const h = get('height');
      if (Number.isNaN(w) || Number.isNaN(h)) return null;
      return { minX: x, minY: y, maxX: x + w, maxY: y + h };
    }
    case 'circle': {
      const cx = Number.isNaN(get('cx')) ? 0 : get('cx');
      const cy = Number.isNaN(get('cy')) ? 0 : get('cy');
      const r = get('r');
      if (Number.isNaN(r)) return null;
      return { minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r };
    }
    case 'ellipse': {
      const cx = Number.isNaN(get('cx')) ? 0 : get('cx');
      const cy = Number.isNaN(get('cy')) ? 0 : get('cy');
      const rx = get('rx');
      const ry = get('ry');
      if (Number.isNaN(rx) || Number.isNaN(ry)) return null;
      return { minX: cx - rx, minY: cy - ry, maxX: cx + rx, maxY: cy + ry };
    }
    case 'line': {
      const x1 = get('x1');
      const y1 = get('y1');
      const x2 = get('x2');
      const y2 = get('y2');
      if ([x1, y1, x2, y2].some(Number.isNaN)) return null;
      return { minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2) };
    }
    case 'polyline':
    case 'polygon': {
      const raw = element.getAttribute('points');
      if (!raw) return null;
      const numbers = raw.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
      if (!numbers || numbers.length < 2) return null;
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i + 1 < numbers.length; i += 2) {
        xs.push(Number(numbers[i]));
        ys.push(Number(numbers[i + 1]));
      }
      return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
    }
    case 'path': {
      const d = element.getAttribute('d');
      if (!d) return null;
      const points = pathPoints(d);
      if (points.length === 0) return null;
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
    }
    case 'text': {
      const x = Number.isNaN(get('x')) ? 0 : get('x');
      const y = Number.isNaN(get('y')) ? 0 : get('y');
      const fontSizeRaw = element.getAttribute('font-size');
      const fontSize = fontSizeRaw ? parseNumber(fontSizeRaw) : 16;
      const size = Number.isNaN(fontSize) ? 16 : fontSize;
      const label = (element.textContent ?? '').trim();
      // Rough estimate: average glyph width ~0.55em, height ~1.2em.
      const width = label.length * size * 0.55;
      const anchor = element.getAttribute('text-anchor') ?? 'start';
      const anchorOffset = anchor === 'middle' ? -width / 2 : anchor === 'end' ? -width : 0;
      return {
        minX: x + anchorOffset,
        minY: y - size * 1.2,
        maxX: x + anchorOffset + width,
        maxY: y + size * 0.25,
      };
    }
    default:
      return null;
  }
}

/**
 * Reads a simple transform list and returns a scale + translation that can be
 * applied to a bounding box. Only `translate`, `scale` and `rotate` are handled;
 * anything else is ignored (treated as identity) to avoid false failures.
 */
function parseTransform(transform: string | null): { scaleX: number; scaleY: number; tx: number; ty: number } {
  const result = { scaleX: 1, scaleY: 1, tx: 0, ty: 0 };
  if (!transform) return result;

  const regex = /(translate|scale|rotate)\s*\(([^)]*)\)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(transform)) !== null) {
    const name = match[1].toLowerCase();
    const args = match[2]
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);

    if (name === 'translate') {
      result.tx += (args[0] ?? 0) * result.scaleX;
      result.ty += (args[1] ?? 0) * result.scaleY;
    } else if (name === 'scale') {
      result.scaleX *= args[0] ?? 1;
      result.scaleY *= args[1] ?? args[0] ?? 1;
    }
    // `rotate` is intentionally ignored: it does not change the bounding box size.
  }

  return result;
}

/** Combines the transforms of an element and all of its ancestors. */
function accumulatedTransform(element: Element): { scaleX: number; scaleY: number; tx: number; ty: number } {
  const chain: Element[] = [];
  let current: Element | null = element;
  while (current) {
    chain.unshift(current);
    current = current.parentElement;
  }

  const total = { scaleX: 1, scaleY: 1, tx: 0, ty: 0 };
  for (const node of chain) {
    const t = parseTransform(node.getAttribute('transform'));
    total.tx = total.tx * t.scaleX + t.tx;
    total.ty = total.ty * t.scaleY + t.ty;
    total.scaleX *= t.scaleX;
    total.scaleY *= t.scaleY;
  }
  return total;
}

/**
 * Check 2: nothing is drawn outside the viewBox.
 */
function checkWithinViewBox(svg: Element): boolean {
  const viewBoxAttr = svg.getAttribute('viewBox');
  if (!viewBoxAttr) return false;

  const parts = viewBoxAttr.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;

  const [minX, minY, width, height] = parts;
  if (width <= 0 || height <= 0) return false;

  const maxX = minX + width;
  const maxY = minY + height;

  const drawables = queryAll(
    svg,
    'rect, circle, ellipse, line, polyline, polygon, path, text, image, use'
  );

  for (const element of drawables) {
    const box = elementBox(element);
    if (!box) continue;

    const transform = accumulatedTransform(element);
    const scaled: Box = {
      minX: box.minX * transform.scaleX + transform.tx,
      minY: box.minY * transform.scaleY + transform.ty,
      maxX: box.maxX * transform.scaleX + transform.tx,
      maxY: box.maxY * transform.scaleY + transform.ty,
    };

    if (
      scaled.minX < minX - EPSILON ||
      scaled.minY < minY - EPSILON ||
      scaled.maxX > maxX + EPSILON ||
      scaled.maxY > maxY + EPSILON
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Check 5 (custom): the SVG must not contain executable content.
 */
function checkNoScripts(doc: Document): boolean {
  if (queryAll(doc, 'script').length > 0) return false;

  if (queryAll(doc, 'foreignObject').length > 0) return false;

  const allElements = queryAll(doc, '*');
  for (const element of allElements) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.toLowerCase().trim();

      // Inline event handlers (onclick, onload, ...) are executable.
      if (name.startsWith('on')) return false;

      // javascript: URLs are executable.
      if ((name === 'href' || name === 'xlink:href' || name === 'src') && value.startsWith('javascript:')) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Runs every validation check against a raw SVG string.
 */
export function validateSVG(svgString: string): ValidationResult {
  const checks = {
    isParsable: false,
    withinViewBox: false,
    hasTitleAndLabels: false,
    hasAnimation: false,
    noScripts: true,
  };

  if (!svgString || !svgString.trim()) {
    return { valid: false, checks, error: 'The model returned an empty response.' };
  }

  let doc: Document;
  try {
    // A malformed diagram makes the parser throw, which is caught here and
    // reported as a failed `isParsable` check.
    doc = parseSvgDocument(svgString);
  } catch (error) {
    return {
      valid: false,
      checks,
      error: `The SVG could not be parsed: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }

  const svg = queryOne(doc, 'svg');
  if (!svg) {
    return { valid: false, checks, error: 'No <svg> root element was found.' };
  }

  checks.isParsable = true;

  // Check 2 - nothing drawn outside the viewBox.
  checks.withinViewBox = checkWithinViewBox(svg);

  // Check 3 - a <title> plus at least 3 <text> labels.
  const title = queryOne(svg, 'title');
  const labels = queryAll(svg, 'text');
  checks.hasTitleAndLabels = Boolean(title && title.textContent?.trim()) && labels.length >= 3;

  // Check 4 - at least one animation (SMIL or CSS).
  const smilAnimations = queryAll(svg, 'animate, animateTransform, animateMotion, set');
  const styleElements = queryAll(svg, 'style');
  const hasCssAnimation = styleElements.some(
    (style) => /@keyframes|animation\s*[:=]/i.test(style.textContent ?? '')
  );
  const hasAnimatedAttribute = queryAll(svg, '*').some((element) =>
    Array.from(element.attributes).some(
      (attribute) =>
        attribute.name === 'class' &&
        /animate|animated|pulse|spin|move|bounce|shake/i.test(attribute.value)
    )
  );
  checks.hasAnimation = smilAnimations.length > 0 || hasCssAnimation || hasAnimatedAttribute;

  // Check 5 (custom) - no executable content.
  checks.noScripts = checkNoScripts(doc);

  const valid =
    checks.isParsable &&
    checks.withinViewBox &&
    checks.hasTitleAndLabels &&
    checks.hasAnimation &&
    checks.noScripts;

  const failedChecks: string[] = [];
  if (!checks.isParsable) failedChecks.push('isParsable');
  if (!checks.withinViewBox) failedChecks.push('withinViewBox');
  if (!checks.hasTitleAndLabels) failedChecks.push('hasTitleAndLabels');
  if (!checks.hasAnimation) failedChecks.push('hasAnimation');
  if (!checks.noScripts) failedChecks.push('noScripts');

  return {
    valid,
    checks,
    error: valid
      ? undefined
      : `The generated SVG failed the following checks: ${failedChecks.join(', ')}.`,
  };
}
