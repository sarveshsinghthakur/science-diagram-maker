import { DOMParser } from '@xmldom/xmldom';
import type { Document, Element, Node } from '@xmldom/xmldom';

export type { Document, Element, Node };

/** `Node.ELEMENT_NODE` - inlined so the module does not need a DOM global. */
const ELEMENT_NODE = 1;

/**
 * Parses an SVG string into an XML DOM.
 *
 * The parser is deliberately strict: a fatal error (or any hard error) aborts
 * the parse and is reported as a thrown exception, so a malformed diagram can
 * never reach the rest of the validator.
 */
export function parseSvgDocument(svgString: string): Document {
  const problems: string[] = [];

  const parser = new DOMParser({
    locator: true,
    onError: (level, message) => {
      problems.push(`${level}: ${String(message).trim()}`);
    },
  });

  const document = parser.parseFromString(svgString, 'text/xml');

  const fatal = problems.filter((problem) =>
    problem.startsWith('fatalError') || problem.startsWith('error')
  );

  if (fatal.length > 0) {
    throw new Error(fatal.join('; ').slice(0, 300));
  }

  if (!document.documentElement) {
    throw new Error('The document does not contain a root element.');
  }

  return document;
}

/**
 * The lower-cased local name of an element.
 *
 * XML is case sensitive and SVG uses camelCase names (`foreignObject`,
 * `animateTransform`), so every comparison in the validator is done on the
 * lower-cased local name to stay tolerant of how the model spelled a tag.
 */
export function tagNameOf(element: Element): string {
  const local = element.localName;
  if (typeof local === 'string' && local.length > 0) return local.toLowerCase();
  return String(element.nodeName ?? '').toLowerCase();
}

/**
 * A tiny `querySelectorAll` that supports the tag-name selectors the
 * validator actually uses: `'rect'`, `'animate, animateTransform'`, `'*'`.
 *
 * It walks the tree once and compares lower-cased local names, which keeps the
 * validator dependency-free (no CSS selector engine needed).
 */
export function queryAll(root: Node, selector: string): Element[] {
  const wanted = selector
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);

  if (wanted.length === 0) return [];

  const matchEverything = wanted.includes('*');
  const results: Element[] = [];

  const visit = (node: Node): void => {
    let child = node.firstChild;
    while (child) {
      // Capture the sibling first: `nextSibling` is not stable while the tree
      // is being mutated, and we never mutate it, but this keeps the walk safe.
      const next = child.nextSibling;
      if (child.nodeType === ELEMENT_NODE) {
        const element = child as Element;
        if (matchEverything || wanted.includes(tagNameOf(element))) {
          results.push(element);
        }
        visit(element);
      }
      child = next;
    }
  };

  visit(root);

  return results;
}

/** The first element matching a tag-name selector, or `null`. */
export function queryOne(root: Node, selector: string): Element | null {
  return queryAll(root, selector)[0] ?? null;
}
