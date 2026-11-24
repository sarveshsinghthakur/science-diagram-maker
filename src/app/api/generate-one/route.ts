import { NextResponse } from 'next/server';
import { CONCEPTS } from '@/lib/constants';
import { generateDiagram } from '@/lib/gemini';

export async function POST(request: Request) {
  try {
    const { conceptId } = await request.json();
    const concept = CONCEPTS.find(c => c.id === conceptId);

    if (!concept) {
      return NextResponse.json({ error: 'Concept not found' }, { status: 404 });
    }

    const result = await generateDiagram(concept);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error generating one diagram:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
