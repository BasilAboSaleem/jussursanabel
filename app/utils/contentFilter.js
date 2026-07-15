/**
 * Content filter for case registration text fields (title, description, storyAr).
 */

/** Always blocked — cannot be removed from admin settings. */
const MANDATORY_FORBIDDEN_WORDS = [
    'شهيد', 'شهداء', 'شهيدة', 'الشهيد', 'استشهاد', 'استشهادي', 'استشهادية',
    'إرهابي', 'ارهابي', 'إرهابية', 'ارهابية',
    'تأييد الإرهاب', 'دعم الإرهاب', 'نصرة الإرهاب',
    'تنظيم إرهابي', 'تنظيم ارهابي',
    'martyr', 'martyrs', 'martyrdom'
];

function normalizeText(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/[\u064B-\u065F\u0670]/g, '')
        .replace(/\u0640/g, '')
        .replace(/[إأآا]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ؤ/g, 'و')
        .replace(/ئ/g, 'ي')
        .toLowerCase()
        .trim();
}

function parseForbiddenWords(raw) {
    if (!raw || typeof raw !== 'string') return [];
    const parts = raw.split(/[,،\n\r]+/);
    const seen = new Set();
    const words = [];
    for (const part of parts) {
        const word = part.trim();
        if (!word) continue;
        const key = normalizeText(word);
        if (key && !seen.has(key)) {
            seen.add(key);
            words.push(word);
        }
    }
    return words;
}

function mergeForbiddenWords(adminWords) {
    const parsed = Array.isArray(adminWords) ? [...adminWords] : parseForbiddenWords(adminWords);
    const seen = new Set(parsed.map((word) => normalizeText(word)));

    for (const word of MANDATORY_FORBIDDEN_WORDS) {
        const key = normalizeText(word);
        if (key && !seen.has(key)) {
            seen.add(key);
            parsed.push(word);
        }
    }

    return parsed;
}

function tokenizeNormalized(text) {
    return text.split(/[\s.,،;:!?؟\-–—()[\]{}«»"'/\\|+]+/).filter(Boolean);
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Match forbidden terms without false positives (e.g. «سب» inside «بسبب»).
 * Short terms (≤3 chars): whole tokens only. Longer terms: token/phrase rules.
 */
function matchesForbiddenTerm(normalizedText, normalizedWord) {
    if (!normalizedText || !normalizedWord) return false;

    if (normalizedWord.includes(' ')) {
        return normalizedText.includes(normalizedWord);
    }

    const tokens = tokenizeNormalized(normalizedText);
    if (tokens.some((token) => token === normalizedWord)) {
        return true;
    }

    if (normalizedWord.length <= 3) {
        return false;
    }

    for (const token of tokens) {
        if (token === `ال${normalizedWord}`) return true;

        const idx = token.indexOf(normalizedWord);
        if (idx === -1) continue;
        if (idx === 0) return true;

        const prefix = token.slice(0, idx);
        if (prefix === 'ال') return true;
    }

    const boundaryPattern = new RegExp(
        `(^|[^\\p{L}\\p{N}])${escapeRegExp(normalizedWord)}([^\\p{L}\\p{N}]|$)`,
        'iu'
    );
    return boundaryPattern.test(normalizedText);
}

function findForbiddenMatches(text, words) {
    if (!text || !words || !words.length) return [];
    const normalizedText = normalizeText(text);
    if (!normalizedText) return [];

    const matches = [];
    const seen = new Set();
    for (const word of words) {
        const normalizedWord = normalizeText(word);
        if (!normalizedWord || normalizedWord.length < 2) continue;
        if (matchesForbiddenTerm(normalizedText, normalizedWord) && !seen.has(normalizedWord)) {
            seen.add(normalizedWord);
            matches.push(word);
        }
    }
    return matches;
}

function validateCaseTextFields({ title, description, storyAr, forbiddenWords }) {
    const words = mergeForbiddenWords(forbiddenWords);

    const fields = [
        { field: 'title', value: title },
        { field: 'description', value: description },
        { field: 'storyAr', value: storyAr }
    ];

    const matches = [];
    for (const { field, value } of fields) {
        const found = findForbiddenMatches(value, words);
        for (const word of found) {
            matches.push({ field, word });
        }
    }

    return {
        ok: matches.length === 0,
        matches
    };
}

module.exports = {
    MANDATORY_FORBIDDEN_WORDS,
    normalizeText,
    parseForbiddenWords,
    mergeForbiddenWords,
    findForbiddenMatches,
    validateCaseTextFields
};
