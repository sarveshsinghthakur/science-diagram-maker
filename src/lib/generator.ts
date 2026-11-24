import fs from 'fs/promises';
import path from 'path';
import { CONCEPTS, type GenerationResult } from './constants';
import { generateDiagram } from './gemini';

const RESULTS_FILE = path.join(process.cwd(), 'results.json');

/**
 * Writes the results back to results.json.
 *
 * On serverless hosts (e.g. Vercel) the file system is read-only at runtime,
 * so a failed write must not break the request: the generated diagrams are
 * still returned to the browser, they are just not persisted on the server.
 */
export async function saveResults(results: GenerationResult[]): Promise<void> {
  try {
    await fs.writeFile(RESULTS_FILE, JSON.stringify(results, null, 2));
    console.log(`Saved ${results.length} diagram(s) to ${RESULTS_FILE}`);
  } catch (error) {
    console.warn(
      `Could not write ${RESULTS_FILE} (read-only file system?): ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/** Reads the previously saved results. Returns [] if the file is missing or invalid. */
export async function getResults(): Promise<GenerationResult[]> {
  try {
    const contents = await fs.readFile(RESULTS_FILE, 'utf-8');
    return JSON.parse(contents) as GenerationResult[];
  } catch {
    return [];
  }
}

/**
 * Part A: asks the model for one animated SVG per concept, validates each one
 * and saves the final results to results.json.
 */
export async function generateAllDiagrams(): Promise<GenerationResult[]> {
  const results: GenerationResult[] = [];

  for (const concept of CONCEPTS) {
    console.log(`Generating diagram for: ${concept.subject}…`);
    try {
      const result = await generateDiagram(concept);
      results.push(result);
      console.log(
        `  -> valid=${result.validation.valid} retries=${result.retries} cost=$${result.cost.toFixed(5)}`
      );
    } catch (error) {
      console.error(
        `  -> failed for ${concept.subject}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  await saveResults(results);
  return results;
}
