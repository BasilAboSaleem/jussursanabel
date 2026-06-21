const PS_IBAN_LENGTH = 29;
const PS_IBAN_REGEX = /^PS\d{2}[A-Z]{4}[A-Z0-9]{21}$/;

const normalizeIban = (iban) => (iban || '').replace(/\s+/g, '').toUpperCase();

function ibanMod97Check(iban) {
    const rearranged = iban.slice(4) + iban.slice(0, 4);
    let remainder = 0;

    for (let i = 0; i < rearranged.length; i++) {
        const code = rearranged.charCodeAt(i);
        const chunk = code >= 65 && code <= 90 ? String(code - 55) : rearranged[i];

        for (let j = 0; j < chunk.length; j++) {
            remainder = (remainder * 10 + parseInt(chunk[j], 10)) % 97;
        }
    }

    return remainder === 1;
}

function validatePalestinianIban(iban) {
    const normalized = normalizeIban(iban);

    if (!normalized) {
        return { valid: false, errorKey: 'register_bank_iban_required' };
    }

    if (normalized.length !== PS_IBAN_LENGTH || !PS_IBAN_REGEX.test(normalized)) {
        return { valid: false, errorKey: 'register_iban_invalid_format' };
    }

    if (!ibanMod97Check(normalized)) {
        return { valid: false, errorKey: 'register_iban_invalid_checksum' };
    }

    return { valid: true, iban: normalized };
}

module.exports = { normalizeIban, validatePalestinianIban };
