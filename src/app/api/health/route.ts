import { NextResponse } from 'next/server';

/**
 * Health check.
 *
 * Reports whether the app can load the two server-side dependencies it needs
 * (the Gemini SDK and the XML based SVG validator) and whether the API key is
 * configured. It never returns the key itself.
 */
export async function GET() {
  const checks: Record<string, string> = {};

  checks.runtime = `node ${process.version}`;

  try {
    await import('@google/generative-ai');
    checks.geminiSdk = 'ok';
  } catch (error) {
    checks.geminiSdk = `FAILED: ${error instanceof Error ? error.message : String(error)}`;
  }

  try {
    const { parseSvgDocument, queryAll } = await import('@/lib/svg-dom');
    const doc = parseSvgDocument('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    checks.xmlParser = queryAll(doc, 'svg').length === 1 ? 'ok' : 'FAILED: parser returned no <svg>';
  } catch (error) {
    checks.xmlParser = `FAILED: ${error instanceof Error ? error.message : String(error)}`;
  }

  try {
    const { validateSVG } = await import('@/lib/validator');
    const result = validateSVG(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>Health</title><rect x="10" y="10" width="20" height="20"/><text x="10" y="50" font-size="10">a</text><text x="10" y="60" font-size="10">b</text><text x="10" y="70" font-size="10">c</text><animate attributeName="x" values="10;20" dur="1s"/></svg>'
    );
    checks.validator = result.valid ? 'ok' : `ok (sample SVG failed: ${result.error})`;
  } catch (error) {
    checks.validator = `FAILED: ${error instanceof Error ? error.message : String(error)}`;
  }

  checks.apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ? 'configured' : 'missing';

  const dependencyChecks = [checks.geminiSdk, checks.xmlParser, checks.validator];
  const healthy =
    dependencyChecks.every((value) => value === 'ok' || value.startsWith('ok (')) &&
    checks.apiKey !== 'missing';

  return NextResponse.json({ healthy, checks }, { status: healthy ? 200 : 500 });
}
