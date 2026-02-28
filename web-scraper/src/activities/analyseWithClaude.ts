import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ScrapedContent } from './scrapeUrls.js';

const execFileAsync = promisify(execFile);

const CLAUDE_CODE_NAMESPACE = process.env.CLAUDE_CODE_NAMESPACE || 'default';
const CLAUDE_CODE_LABEL = process.env.CLAUDE_CODE_LABEL || 'app=claude-code';

export interface AnalysisInput {
    instruction: string;
    scrapedContent: ScrapedContent[];
}

export interface AnalysisResult {
    shouldNotify: boolean;
    message: string;
}

export async function analyseWithClaude(input: AnalysisInput): Promise<AnalysisResult> {
    // Find running Claude Code pod
    const { stdout: podName } = await execFileAsync('kubectl', [
        'get', 'pods',
        '-n', CLAUDE_CODE_NAMESPACE,
        '-l', CLAUDE_CODE_LABEL,
        '--field-selector=status.phase=Running',
        '-o', 'jsonpath={.items[0].metadata.name}',
    ]);

    if (!podName || podName === '') {
        throw new Error('No running Claude Code pod found');
    }

    // Build scraped content for the prompt
    const contentText = input.scrapedContent
        .map((c) => `--- URL: ${c.url} ---\n${c.text}`)
        .join('\n\n');

    const promptString = `You are a web monitoring assistant. The user has configured a monitoring job with this instruction:

"${input.instruction}"

Below is the content scraped from the monitored URLs:

${contentText}

Analyze the scraped content against the user's instruction. Respond in this exact JSON format:
{"shouldNotify": true/false, "message": "WhatsApp message if notifying, or brief status if not"}

Rules:
- Set shouldNotify to true ONLY if the content matches what the user asked to be alerted about
- If notifying, write a concise WhatsApp-friendly message using *bold* for emphasis
- If not notifying, set message to a brief status like "No matching content found"
- Do not hallucinate or invent information not present in the scraped content`;

    // Pipe prompt via stdin to avoid ARG_MAX limits
    const child = execFileAsync('kubectl', [
        'exec', '-n', CLAUDE_CODE_NAMESPACE, podName.trim(), '-i', '--',
        'claude', '--output-format', 'text', '-p', '-',
    ], { maxBuffer: 1024 * 1024, timeout: 120000 });

    child.child.stdin?.write(promptString);
    child.child.stdin?.end();

    const { stdout: response } = await child;

    if (!response || response.trim() === '') {
        throw new Error('Claude returned empty response');
    }

    // Parse JSON from Claude's response
    try {
        // Try to find JSON in the response (Claude may wrap it in text)
        const jsonMatch = response.match(/\{[\s\S]*"shouldNotify"[\s\S]*\}/);
        if (!jsonMatch) {
            console.warn('[Claude] No JSON found in response, defaulting to no-notify:', response.trim());
            return { shouldNotify: false, message: 'Parse error: no JSON in response' };
        }
        const parsed = JSON.parse(jsonMatch[0]);
        return {
            shouldNotify: Boolean(parsed.shouldNotify),
            message: String(parsed.message || ''),
        };
    } catch (err) {
        console.warn('[Claude] Failed to parse JSON response, defaulting to no-notify:', response.trim());
        return { shouldNotify: false, message: 'Parse error' };
    }
}
