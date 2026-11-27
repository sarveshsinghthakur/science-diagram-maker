import { NextResponse } from 'next/server';

export async function POST() {
  try {
    // Lazy import for the same reason as /api/generate-one: a broken
    // dependency must produce a readable error, not an empty 500.
    const { generateAllDiagrams } = await import('@/lib/generator');
    const results = await generateAllDiagrams();
    return NextResponse.json(results);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unexpected error while generating the diagrams.';
    console.error(`[generate-all] ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
