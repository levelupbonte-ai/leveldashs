import 'server-only';
import { geminiRotator } from '@/lib/ai/gemini';
import { generateText } from '@/lib/ai/router';
import {
  type AssistantContext,
  type AssistantImage,
  type AssistantSource,
  type SiteContext,
  assistantSystemPrompt,
  assistantUserPrompt,
  cleanSources,
  handoffPrompt,
  parseHandoff
} from './assistant-prompt';

export { parseImage } from './assistant-prompt';

/**
 * Members' assistant of a client portal. Gemini with Google Search grounding
 * answers with fresh, cited sources; when every Gemini key is resting, the
 * usual text route answers without live search and says so. Keys stay on the
 * LevelUp server (GEMINI_API_KEYS and the router's keys).
 */

const GROUNDED_MODELS = (
  process.env.PORTAL_ASSISTANT_MODELS ||
  'gemini-3.5-flash,gemini-3-flash-preview,gemini-3.1-flash-lite'
)
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

export async function answerQuestion(
  ctx: AssistantContext,
  site: SiteContext = {},
  images: AssistantImage[] = []
): Promise<{ text: string; sources: AssistantSource[] }> {
  const system = assistantSystemPrompt(ctx);
  const prompt = assistantUserPrompt(ctx, site);

  for (const model of GROUNDED_MODELS) {
    try {
      const result = await geminiRotator.executeWithRotation(async (ai) => {
        const resp = await ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                ...images.map((i) => ({ inlineData: { mimeType: i.mimeType, data: i.data } })),
                { text: prompt }
              ]
            }
          ],
          config: {
            systemInstruction: system,
            tools: [{ googleSearch: {} }],
            temperature: 0.3,
            maxOutputTokens: 1400,
            abortSignal: AbortSignal.timeout(40_000)
          }
        });
        return {
          text: (resp.text ?? '').trim(),
          sources: cleanSources(resp.candidates?.[0]?.groundingMetadata?.groundingChunks)
        };
      }, 3);
      if (result.text) return result;
    } catch {
      // next model
    }
  }

  // No live search available: answer from what we know, and say so.
  const text = await generateText('writing', {
    system: `${system}\n\nLive web search is not available for this answer: say briefly that official sources could not be checked today, give only general guidance, and suggest confirming with official sources or with the "Ask" button.${images.length ? ' The attached image could not be read this time: say so and ask the member to try again later.' : ''}`,
    prompt,
    maxTokens: 900,
    temperature: 0.3
  });
  return { text, sources: [] };
}

export async function prepareHandoff(input: {
  site: string;
  question: string;
  answer: string | null;
  profile: Record<string, unknown> | null;
}): Promise<{ summary: string; draft: string }> {
  const { system, prompt } = handoffPrompt(input);
  try {
    const text = await generateText('writing', {
      system,
      prompt,
      maxTokens: 700,
      temperature: 0.4
    });
    const parsed = parseHandoff(text);
    if (parsed) return parsed;
  } catch {
    // the handoff still goes through, without a prepared reply
  }
  return { summary: '', draft: '' };
}
