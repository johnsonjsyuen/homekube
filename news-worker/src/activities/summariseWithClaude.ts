import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Article } from './scrapeArticles.js';

const execFileAsync = promisify(execFile);

const CLAUDE_CODE_NAMESPACE = process.env.CLAUDE_CODE_NAMESPACE || 'default';
const CLAUDE_CODE_LABEL = process.env.CLAUDE_CODE_LABEL || 'app=claude-code';

export async function summariseWithClaude(articles: Article[]): Promise<string> {
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

    // Build article text for the prompt
    const articleText = articles
        .map((a, i) => `Article ${i + 1}: ${a.title}\nURL: ${a.link}\n${a.text}`)
        .join('\n\n---\n\n');

    const promptString = `You are a news digest assistant. Summarise the following Australian news articles into a WhatsApp-friendly daily digest.

Format rules:
- Start with a greeting line: "*Daily News Digest*" followed by today's date
- For each article, use *bold* for the headline title
- Write 1-2 sentence summary for each article
- After each summary, include the original article URL on its own line so readers can tap to read more
- Keep the total digest concise and readable on a phone screen
- Use plain text formatting suitable for WhatsApp (no markdown links, just *bold* for emphasis and plain URLs)
- Number each article
- End with a sign-off line

Here are the articles:

${articleText}`;

    // Pipe prompt via stdin to avoid ARG_MAX limits with large article payloads
    const child = execFileAsync('kubectl', [
        'exec', '-n', CLAUDE_CODE_NAMESPACE, podName.trim(), '-i', '--',
        'claude', '--output-format', 'text', '-p', '-',
    ], { maxBuffer: 1024 * 1024, timeout: 120000 });

    child.child.stdin?.write(promptString);
    child.child.stdin?.end();

    const { stdout: digest } = await child;

    if (!digest || digest.trim() === '') {
        throw new Error('Claude returned empty digest');
    }

    return digest.trim();
}
