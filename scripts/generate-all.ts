import { generateAllDiagrams } from '../src/lib/generator';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('Starting generation of all 5 diagrams...');
  try {
    const results = await generateAllDiagrams();
    console.log('Successfully generated all diagrams!');
    console.table(results.map(r => ({
      Subject: r.subject,
      Retries: r.retries,
      Cost: `$${r.cost.toFixed(4)}`,
      Valid: r.validation.valid ? 'YES' : 'NO'
    })));
  } catch (error) {
    console.error('Error during generation:', error);
    process.exit(1);
  }
}

main();
