import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Concept, GenerationResult } from './constants';
import { validateSVG } from './validator';

/**
 * Free Gemini models to try, in order. The first one that the API accepts is
 * used for every request; the others are fallbacks for accounts that cannot
 * access a particular model.
 *
 * Override the primary model with the GEMINI_MODEL environment variable.
 */
const MODEL_FALLBACKS = [
  process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
].filter(Boolean);

/**
 * Estimated price per 1M tokens (USD).
 * Free-tier requests cost $0, but the pricing is used so the dashboard shows a
 * meaningful "what would this cost on the paid tier" number.
 */
const INPUT_COST_PER_MILLION = 0.075;
const OUTPUT_COST_PER_MILLION = 0.30;

const API_RETRY_LIMIT = 3; // "wait and try again, up to 3 times" for 429 / 503
const VALIDATION_RETRY_LIMIT = 1; // "if a check fails, retry once"
const BASE_BACKOFF_MS = 2000;

function getApiKey(): string {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      'GOOGLE_GENERATIVE_AI_API_KEY is not set. Add it to .env.local (or your host’s environment variables) and restart the app.'
    );
  }
  return key;
}

function buildPrompt(concept: Concept, failureReason?: string): string {
  return `Create an animated SVG diagram for a UK GCSE science lesson.

Concept: ${concept.subject}
Topic text: ${concept.text}

Requirements:
1. Output ONLY the SVG source code. Start with <svg and end with </svg>.
2. Do NOT wrap the output in markdown code fences and do NOT add any commentary.
3. The root element must include xmlns="http://www.w3.org/2000/svg" and a viewBox attribute.
4. Every drawn element must sit completely inside the viewBox.
5. Include a <title> element describing the diagram.
6. Include at least 3 <text> elements labelling the important parts of the diagram.
7. Include at least one animation, either a SMIL element (<animate>, <animateTransform>) or a <style> block using CSS @keyframes.
8. Keep the colour palette clean and high contrast so it is readable on a whiteboard.
9. Do not include <script> elements, inline on* event handlers or foreignObject elements.
${
  failureReason
    ? `\nIMPORTANT: your previous attempt was rejected by our validator because: ${failureReason}\nFix that specific problem in your new answer.`
    : ''
}`;
}

/** Strips markdown fences that Gemini sometimes adds around the SVG. */
function cleanSvg(raw: string): string {
  let svg = raw.trim();

  const fence = svg.match(/^```(?:svg|xml|html)?\s*([\s\S]*?)\s*```$/i);
  if (fence) {
    svg = fence[1].trim();
  }

  // Remove any leading prose before the first <svg and trailing content after the last </svg>.
  const start = svg.indexOf('<svg');
  const end = svg.lastIndexOf('</svg>');
  if (start !== -1 && end !== -1 && end > start) {
    svg = svg.slice(start, end + '</svg>'.length);
  }

  return svg;
}

interface AttemptContext {
  validationRetries: number;
  apiRetries: number;
  modelIndex: number;
  failureReason?: string;
}

async function requestSvg(
  concept: Concept,
  context: AttemptContext
): Promise<{ svg: string; modelName: string; inputTokens: number; outputTokens: number }> {
  const genAI = new GoogleGenerativeAI(getApiKey());
  const modelName = MODEL_FALLBACKS[context.modelIndex];

  const model = genAI.getGenerativeModel({ model: modelName });
  const result = await model.generateContent(buildPrompt(concept, context.failureReason));
  const response = await result.response;

  return {
    svg: cleanSvg(response.text()),
    modelName,
    inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

/** Waits for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  return status === 429 || status === 503;
}

function isModelUnavailable(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  return status === 404 || status === 400;
}

/**
 * Part A core: ask the model for one animated SVG, validate it in code and
 * retry once (telling the model why) if a check fails.
 */
export async function generateDiagram(concept: Concept): Promise<GenerationResult> {
  let validationRetries = 0;
  let apiRetries = 0;
  let modelIndex = 0;
  let failureReason: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const { svg, modelName, inputTokens, outputTokens } = await requestSvg(concept, {
        validationRetries,
        apiRetries,
        modelIndex,
        failureReason,
      });

      const validation = validateSVG(svg);
      const cost =
        (inputTokens / 1_000_000) * INPUT_COST_PER_MILLION +
        (outputTokens / 1_000_000) * OUTPUT_COST_PER_MILLION;

      const buildResult = (): GenerationResult => ({
        conceptId: concept.id,
        subject: concept.subject,
        svg,
        modelName,
        inputTokens,
        outputTokens,
        cost,
        retries: validationRetries + apiRetries,
        validation,
        status: 'pending',
      });

      if (validation.valid) {
        return buildResult();
      }

      if (validationRetries < VALIDATION_RETRY_LIMIT) {
        validationRetries += 1;
        failureReason = validation.error;
        console.warn(
          `[${concept.subject}] Validation failed (${validation.error}). Retrying once with the reason.`
        );
        continue;
      }

      // The retry also failed: return the result so the reviewer can see which
      // checks did not pass instead of silently dropping the diagram.
      return buildResult();
    } catch (error) {
      if (isModelUnavailable(error) && modelIndex < MODEL_FALLBACKS.length - 1) {
        modelIndex += 1;
        console.warn(
          `[${concept.subject}] Model unavailable, falling back to ${MODEL_FALLBACKS[modelIndex]}.`
        );
        continue;
      }

      if (isRetryableStatus(error) && apiRetries < API_RETRY_LIMIT) {
        apiRetries += 1;
        const waitMs = BASE_BACKOFF_MS * 2 ** (apiRetries - 1);
        console.warn(
          `[${concept.subject}] API error (${(error as { status?: number }).status}). Waiting ${waitMs}ms before retry ${apiRetries}/${API_RETRY_LIMIT}.`
        );
        await sleep(waitMs);
        continue;
      }

      throw error;
    }
  }
}
