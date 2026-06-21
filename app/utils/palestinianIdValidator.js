const PS_ID_LENGTH = 9;

const normalizePalestinianId = (id) => {
    const digits = (id || '').replace(/\D/g, '');
    if (!digits) return '';
    return digits.padStart(PS_ID_LENGTH, '0').slice(-PS_ID_LENGTH);
};

const reduceWeightedProduct = (product) => {
    if (product < 10) return product;
    return Math.floor(product / 10) + (product % 10);
};

/**
 * Palestinian ID checksum (Ministry of Interior / MOD-10):
 * - Pad to 9 digits with leading zeros
 * - From the right, alternate weights 1, 2, 1, 2...
 * - Multiply each digit by its weight; if product >= 10, sum its digits
 * - Valid when the total sum is divisible by 10
 */
function validatePalestinianId(id) {
    const raw = (id || '').trim();
    const digitsOnly = raw.replace(/\D/g, '');

    if (!digitsOnly) {
        return { valid: false, errorKey: 'flash_id_required' };
    }

    if (digitsOnly.length > PS_ID_LENGTH) {
        return { valid: false, errorKey: 'register_id_length_error' };
    }

    const normalized = digitsOnly.padStart(PS_ID_LENGTH, '0');

    if (!/^\d{9}$/.test(normalized)) {
        return { valid: false, errorKey: 'register_id_invalid_format' };
    }

    let sum = 0;
    for (let i = 0; i < PS_ID_LENGTH; i++) {
        const digit = parseInt(normalized[PS_ID_LENGTH - 1 - i], 10);
        const weight = i % 2 === 0 ? 1 : 2;
        sum += reduceWeightedProduct(digit * weight);
    }

    if (sum % 10 !== 0) {
        return { valid: false, errorKey: 'register_id_invalid_checksum' };
    }

    return { valid: true, idNumber: normalized };
}

module.exports = { normalizePalestinianId, validatePalestinianId };
