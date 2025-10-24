import 'dotenv/config';
// Mistral Large client with simple concurrency limit and retries
const CONCURRENT_LLM_REQUESTS = Number(process.env.CONCURRENT_LLM_REQUESTS || 2);
const MISTRAL_API_URL = process.env.MISTRAL_API_URL || 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || '';
const ANTHROPIC_API_URL = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

const queue = [];
let active = 0;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTask(task) {
    active++;
    try {
        const result = await task();
        return result;
    } finally {
        active--;
        schedule();
    }
}

function schedule() {
    while (active < CONCURRENT_LLM_REQUESTS && queue.length > 0) {
        const { fn, resolve, reject } = queue.shift();
        runTask(fn).then(resolve).catch(reject);
    }
}

function enqueue(fn) {
    return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        schedule();
    });
}

export async function evaluateWords(words, provider = 'mistral') {
    const uniqueWords = Array.from(new Set(words.filter(Boolean)));
    if (uniqueWords.length === 0) return { evaluations: [] };

    console.log(`[LLM] Starting evaluation via ${provider} for ${uniqueWords.length} words: ${uniqueWords.join(', ')}`);

    return enqueue(async () => {
        const system = 'You are evaluating German words for a friendly, creativity-focused word game.';
        const user = {
            language: 'German',
            words: uniqueWords,
            instructions:
                'For each word, return a score 1–100 based on creativity, rarity, and beauty. No bonuses for length or position. Output JSON with evaluations: [{word, score, explanation}] and keep explanations brief. Explanation has to be in German.'
        };
        const { url, headers, body, parseContent } = buildProviderRequest(provider, system, user);

        const attempts = 3;
        let lastErr;
        for (let i = 0; i < attempts; i++) {
            try {
                console.log(`[LLM] Attempt ${i + 1}/${attempts} - Making API request to ${provider}`);
                const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const json = await resp.json();
                const content = parseContent(json) || '';
                const unfenced = unwrapFencedCode(content);
                const parsed = safeParseEvaluations(unfenced);
                if (parsed) {
                    console.log(`[LLM] Successfully evaluated ${parsed.evaluations.length} words on attempt ${i + 1}`);
                    return parsed;
                }
                // If parsing failed, try to extract JSON substring
                const maybe = extractJsonOrArray(unfenced);
                const parsed2 = safeParseEvaluations(maybe || '');
                if (parsed2) {
                    console.log(`[LLM] Successfully evaluated ${parsed2.evaluations.length} words on attempt ${i + 1} (after JSON extraction)`);
                    return parsed2;
                }
                throw new Error('Invalid LLM response');
            } catch (e) {
                console.log(`[LLM] Attempt ${i + 1} failed: ${e.message}`);
                lastErr = e;
                await delay(400 * (i + 1));
            }
        }
        console.log(`[LLM] All ${attempts} attempts failed. Last error: ${lastErr?.message || 'Unknown error'}`);
        throw lastErr || new Error('LLM request failed');
    });
}

function buildProviderRequest(provider, system, user) {
    const upper = String(provider || '').toLowerCase();
    if (upper === 'anthropic' || upper === 'claude' || upper === 'claude-haiku-4-5') {
        return {
            url: ANTHROPIC_API_URL,
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: {
                model: 'claude-haiku-4-5',
                max_tokens: 1024,
                temperature: 0,
                system,
                messages: [
                    { role: 'user', content: JSON.stringify(user) }
                ]
            },
            parseContent: (json) => {
                const parts = json?.content;
                if (Array.isArray(parts) && parts.length > 0) {
                    const first = parts.find((p) => typeof p?.text === 'string');
                    return first?.text || '';
                }
                return '';
            }
        };
    }
    if (upper === 'deepseek' || upper === 'deepseek-chat') {
        return {
            url: DEEPSEEK_API_URL,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${DEEPSEEK_API_KEY}`
            },
            body: {
                model: 'deepseek-chat',
                temperature: 0,
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: JSON.stringify(user) }
                ]
            },
            parseContent: (json) => json?.choices?.[0]?.message?.content || ''
        };
    }
    // Default: Mistral
    return {
        url: MISTRAL_API_URL,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${MISTRAL_API_KEY}`
        },
        body: {
            model: 'mistral-large-latest',
            temperature: 0.0,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: JSON.stringify(user) }
            ]
        },
        parseContent: (json) => json?.choices?.[0]?.message?.content || ''
    };
}

function safeParseEvaluations(text) {
    try {
        const obj = JSON.parse(text);
        if (!obj) return null;
        let arr = null;
        if (Array.isArray(obj)) {
            arr = obj;
        } else if (typeof obj === 'object' && Array.isArray(obj.evaluations)) {
            arr = obj.evaluations;
        }
        if (!arr) return null;
        const evaluations = arr
            .map((e) => ({ word: String(e.word || '').toUpperCase(), score: toInt(e.score), explanation: String(e.explanation || '') }))
            .filter((e) => e.word && e.score >= 1 && e.score <= 100);
        return { evaluations };
    } catch {
        return null;
    }
}

function extractJsonOrArray(text) {
    const objStart = text.indexOf('{');
    const objEnd = text.lastIndexOf('}');
    const arrStart = text.indexOf('[');
    const arrEnd = text.lastIndexOf(']');
    const hasObj = objStart !== -1 && objEnd !== -1 && objEnd > objStart;
    const hasArr = arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart;
    if (hasObj && (!hasArr || objStart < arrStart)) return text.slice(objStart, objEnd + 1);
    if (hasArr) return text.slice(arrStart, arrEnd + 1);
    return null;
}

function toInt(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n);
}

function unwrapFencedCode(text) {
    if (!text) return text;
    // Trim to avoid leading spaces/newlines interfering
    const t = String(text).trim();
    if (!t.startsWith('```')) return text;
    // Match ```lang\n...\n```
    const first = t.indexOf('```');
    const last = t.lastIndexOf('```');
    if (first === -1 || last === -1 || last <= first) return text;
    // Remove the first fence (and optional language id) and the last fence
    const inner = t.slice(first + 3, last);
    // Drop optional language identifier on first line
    const nl = inner.indexOf('\n');
    if (nl !== -1) {
        return inner.slice(nl + 1).trim();
    }
    return inner.trim();
}


