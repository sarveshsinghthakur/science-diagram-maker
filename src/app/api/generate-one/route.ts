import { NextResponse } from 'next/server';
import { CONCEPTS } from '@/lib/constants';

export async function POST(request: Request) {
  try {
    const { conceptId } = await request.json();
    const concept = CONCEPTS.find((candidate) => candidate.id === conceptId);

    if (!concept) {
      return NextResponse.json({ error: `Unknown concept id: ${conceptId}` }, { status: 404 });
    }

    /*
     * The generation module is imported lazily, inside the try block.
     *
     * If one of its dependencies (the Gemini SDK, jsdom) cannot be loaded by
     * the serverless runtime, the failure happens here instead of while the
     * route module is being evaluated. That means the browser gets a readable
     * error message instead of an empty 500 response.
     */
    const { generateDiagram } = await import('@/lib/gemini');
    const result = await generateDiagram(concept);

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unexpected error while generating the diagram.';
    console.error(`[generate-one] ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
