const UNIT_MS = { d: 86400000, h: 3600000, m: 60000, s: 1000 };

function parseJwtDuration(str, fallbackMs = 7 * 86400000) {
    if (!str) return fallbackMs;
    const match = String(str).trim().match(/^(\d+)([dhms])$/i);
    if (!match) return fallbackMs;
    const num = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    return num * (UNIT_MS[unit] || fallbackMs);
}

module.exports = { parseJwtDuration };
