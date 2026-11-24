import { NextResponse } from 'next/server';
import { generateAllDiagrams } from '@/lib/generator';

export async function POST(request: Request) {
  try {
    const results = await generateAllDiagrams();
    return NextResponse.json(results);
  } catch (error: any) {
    console.error('Error generating all diagrams:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
