const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'youtu.be', 'www.youtu.be'];
const DIRECT_VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg', '.m4v', '.mov'];
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const NON_DIRECT_PAGE_HOSTS = ['instagram.com', 'www.instagram.com', 'tiktok.com', 'www.tiktok.com', 'facebook.com', 'www.facebook.com'];

function isYouTubeUrl(urlString = '') {
    try {
        const url = new URL(urlString);
        return YOUTUBE_HOSTS.includes(url.hostname.toLowerCase());
    } catch {
        return false;
    }
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
    isYouTubeUrl
};
