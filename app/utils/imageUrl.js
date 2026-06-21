const DEFAULT_CASE_IMAGE =
    'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?q=80&w=480&auto=format&fit=crop';

function caseCardImageUrl(url, { width = 480, height = 360 } = {}) {
    if (!url || typeof url !== 'string') return DEFAULT_CASE_IMAGE;

    const trimmed = url.trim();
    if (!trimmed) return DEFAULT_CASE_IMAGE;

    if (trimmed.includes('res.cloudinary.com') && trimmed.includes('/upload/')) {
        return trimmed.replace(
            '/upload/',
            `/upload/w_${width},h_${height},c_fill,q_auto,f_auto/`
        );
    }

    if (trimmed.includes('images.unsplash.com')) {
        try {
            const parsed = new URL(trimmed);
            parsed.searchParams.set('w', String(width));
            parsed.searchParams.set('q', '80');
            parsed.searchParams.set('auto', 'format');
            parsed.searchParams.set('fit', 'crop');
            return parsed.toString();
        } catch {
            return trimmed;
        }
    }

    return trimmed;
}

module.exports = {
    DEFAULT_CASE_IMAGE,
    caseCardImageUrl
};
