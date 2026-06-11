/** Pages */
const BASE_URL = 'https://www.coursera.org';

exports.BASE_URL = BASE_URL;
exports.LOGIN_PAGE = BASE_URL + '/?authMode=login';

/** Selectors */
exports.LOGIN_EMAIL_SELECTOR = 'input[name="email"]';
exports.LOGIN_PASSWORD_SELECTOR = 'input[name="password"]';
exports.LOGIN_FAILED_SELECTOR = '.css-q1vc80 > span:nth-child(1)';

/** Domains */
exports.COURSERA_DOMAINS = new Set([
    'coursera.org',
    'courseracdn.com',
    'd3njjcbhbojbot.cloudfront.net',
    'coursera_assets.s3.amazonaws.com',
    'coursera-api.arkoselabs.com',
    'accounts.google.com',
    'www.gstatic.com',
    'cdn.cookielaw.org',
    'geolocation.onetrust.com',
    'coursera-course-photos.s3.amazonaws.com'
]);

exports.BLOCKED_DOMAINS = new Set([
    'browser.sentry-cdn.com',
    'sentry.io',
    'www.googletagmanager.com',
    'googleads.g.doubleclick.net',
    'pagead2.googlesyndication.com',
    'connect.facebook.net',
    'www.facebook.com',
    'bat.bing.com',
    'bat.bing.net',
    'analytics.tiktok.com',
    'analytics-ipv6.tiktokw.us',
    'cdn.amplitude.com',
    'sr-client-cfg.amplitude.com',
    'www.redditstatic.com',
    'pixel-config.reddit.com',
    'alb.reddit.com',
    'a.quora.com',
    'q.quora.com',
    'storage.cloud.kargo.com',
    'kds-pixel.kargo.com',
    'utt.impactcdn.com',
    'bzrcdn.openai.com',
    'bzr.openai.com',
]);