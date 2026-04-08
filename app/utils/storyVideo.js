const YOUTUBE_HOSTS = [
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtu.be',
    'www.youtu.be',
    'youtube-nocookie.com',
    'www.youtube-nocookie.com'
];
const DIRECT_VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg', '.m4v', '.mov'];
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const NON_DIRECT_PAGE_HOSTS = ['instagram.com', 'www.instagram.com', 'tiktok.com', 'www.tiktok.com', 'facebook.com', 'www.facebook.com'];
const cloudinaryEnabled = Boolean(CLOUDINARY_CLOUD_NAME);

function isYouTubeUrl(urlString = '') {
    try {
        const url = new URL(urlString);
        return YOUTUBE_HOSTS.includes(url.hostname.toLowerCase());
    } catch {
        return false;
    }
}

function extractYouTubeId(urlString = '') {
    try {
        const url = new URL(urlString);
        const host = url.hostname.toLowerCase();

        if (!YOUTUBE_HOSTS.includes(host)) return null;

        // youtu.be/<id>
        if (host.includes('youtu.be')) {
            const id = url.pathname.split('/').filter(Boolean)[0];
            return id || null;
        }

        // youtube.com/watch?v=<id>
        const v = url.searchParams.get('v');
        if (v) return v;

        // youtube.com/shorts/<id>
        const shortsMatch = url.pathname.match(/\/shorts\/([^/?#]+)/i);
        if (shortsMatch && shortsMatch[1]) return shortsMatch[1];

        // youtube.com/embed/<id>
        const embedMatch = url.pathname.match(/\/embed\/([^/?#]+)/i);
        if (embedMatch && embedMatch[1]) return embedMatch[1];

        return null;
    } catch {
        return null;
    }
}

function buildYouTubeEmbedUrl(youtubeId, { muted = 0 } = {}) {
    if (!youtubeId) return null;
    const m = muted ? 1 : 0;
    return `https://www.youtube.com/embed/${youtubeId}?enablejsapi=1&mute=${m}&controls=0&autoplay=0&loop=1&playlist=${youtubeId}&playsinline=1&rel=0&modestbranding=1`;
}

function hasDirectVideoExtension(pathname = '') {
    const cleanPath = pathname.toLowerCase().split('?')[0].split('#')[0];
    return DIRECT_VIDEO_EXTENSIONS.some(ext => cleanPath.endsWith(ext));
}

function isCloudinaryUrl(urlString = '') {
    return /res\.cloudinary\.com/i.test(urlString) && /\/upload\//i.test(urlString);
}

function normalizeCloudinaryVideoUrl(urlString = '') {
    if (!isCloudinaryUrl(urlString)) return urlString;

    const transformation = 'f_mp4,vc_h264,ac_aac,q_auto,fl_progressive';
    if (/\/upload\/[^/]+\/v\d+/i.test(urlString)) {
        return urlString.replace(/\/upload\/([^/]+)\/(v\d+)/i, `/upload/${transformation},$1/$2`);
    }
    if (/\/upload\/v\d+/i.test(urlString)) {
        return urlString.replace(/\/upload\/(v\d+)/i, `/upload/${transformation}/$1`);
    }
    if (/\/upload\/[^/]+\//i.test(urlString)) {
        return urlString.replace(/\/upload\/([^/]+)\//i, `/upload/${transformation},$1/`);
    }
    return urlString.replace('/upload/', `/upload/${transformation}/`);
}

function toCloudinaryFetchUrl(remoteUrl = '') {
    if (!CLOUDINARY_CLOUD_NAME) return remoteUrl;
    try {
        const parsed = new URL(remoteUrl);
        if (!/^https?:$/.test(parsed.protocol)) return remoteUrl;
        const encoded = encodeURIComponent(remoteUrl);
        const transformation = 'f_mp4,vc_h264,ac_aac,q_auto,fl_progressive';
        return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/fetch/${transformation}/${encoded}`;
    } catch {
        return remoteUrl;
    }
}

function getPlayableStoryVideoUrl(rawUrl = '') {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const trimmed = rawUrl.trim();
    if (!trimmed) return null;

    if (isYouTubeUrl(trimmed)) return trimmed;
    if (isCloudinaryUrl(trimmed)) return normalizeCloudinaryVideoUrl(trimmed);

    try {
        const parsed = new URL(trimmed);
        if (NON_DIRECT_PAGE_HOSTS.includes(parsed.hostname.toLowerCase())) return null;
        if (hasDirectVideoExtension(parsed.pathname)) return toCloudinaryFetchUrl(trimmed);
        return toCloudinaryFetchUrl(trimmed);
    } catch {
        return null;
    }
}

module.exports = {
    getPlayableStoryVideoUrl,
    isYouTubeUrl,
    extractYouTubeId,
    buildYouTubeEmbedUrl,
    cloudinaryEnabled
};
