import 'dotenv/config';
// Mistral Large client with simple concurrency limit and retries
const CONCURRENT_LLM_REQUESTS = Number(process.env.CONCURRENT_LLM_REQUESTS || 2);
const MISTRAL_API_URL = process.env.MISTRAL_API_URL || 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || '';

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

export async function evaluateWords(words) {
    const uniqueWords = Array.from(new Set(words.filter(Boolean)));
    if (uniqueWords.length === 0) return { evaluations: [] };
    return enqueue(async () => {
        const system = 'You are evaluating German words for a friendly, creativity-focused word game.';
        const user = {
            language: 'German',
            words: uniqueWords,
            instructions:
                'For each word, return a score 1–100 based on creativity, rarity, and beauty. No bonuses for length or position. Output JSON with evaluations: [{word, score, explanation}] and keep explanations brief. Explanation has to be in German.'
        };
        const body = {
            model: 'mistral-large-latest',
            temperature: 0.0,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: JSON.stringify(user) }
            ]
        };

        const headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${MISTRAL_API_KEY}`
        };

        const attempts = 3;
        let lastErr;
        for (let i = 0; i < attempts; i++) {
            try {
                const resp = await fetch(MISTRAL_API_URL, { method: 'POST', headers, body: JSON.stringify(body) });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const json = await resp.json();
                const content = json?.choices?.[0]?.message?.content || '';
                const unfenced = unwrapFencedCode(content);
                const parsed = safeParseEvaluations(unfenced);
                if (parsed) return parsed;
                // If parsing failed, try to extract JSON substring
                const maybe = extractJsonOrArray(unfenced);
                const parsed2 = safeParseEvaluations(maybe || '');
                if (parsed2) return parsed2;
                throw new Error('Invalid LLM response');
            } catch (e) {
                lastErr = e;
                await delay(400 * (i + 1));
            }
        }
        throw lastErr || new Error('LLM request failed');
    });
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


