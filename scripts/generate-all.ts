import dotenv from 'dotenv';
import { generateAllDiagrams } from '../src/lib/generator';

// Next.js reads .env.local, so the script does too. .env is kept as a fallback.
dotenv.config({ path: ['.env.local', '.env'] });

async function main() {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    console.error(
      'GOOGLE_GENERATIVE_AI_API_KEY is missing. Copy .env.example to .env.local and add your key.'
    );
    process.exit(1);
  }

  console.log('Starting generation of all 5 diagrams...');
  try {
    const results = await generateAllDiagrams();
    console.log('Successfully generated all diagrams!');
    console.table(
      results.map((result) => ({
        Subject: result.subject,
        Valid: result.validation.valid ? 'YES' : 'NO',
        Retries: result.retries,
        Model: result.modelName,
        'Tokens in': result.inputTokens,
        'Tokens out': result.outputTokens,
        'Cost (USD)': `$${result.cost.toFixed(5)}`,
      }))
    );
  } catch (error) {
    console.error('Error during generation:', error);
    process.exit(1);
  }
}

main();
