const { EventEmitter } = require('node:events');
const { differenceBy } = require('lodash');
const Constants = require('../utils/constants');
const puppeteer = require('puppeteer-extra');
const path = require('node:path');
const pc = require('picocolors');

// Setup stealth plugin
puppeteer.use(require('puppeteer-extra-plugin-stealth')());

/**
 * @typedef {Object} Credentials
 * @property {string} email - The account e-mail address.
 * @property {string} password - The account password.
 */

/**
 * @typedef {Object} LoginTimeoutOptions
 * @property {number} [selectors] - Max ms to wait for input selectors to appear.
 * @property {number} [login] - Max ms to wait for the auth cookie after submitting credentials.
 * @property {number} [page] - Max ms to wait for page navigation.
 */

/**
 * @typedef {Object} LoginOptions
 * @property {LoginTimeoutOptions} timeout - Timeout settings for the login flow.
 * @property {number} typingDelay - Delay in ms between keystrokes when typing credentials.
 */

/**
 * @typedef {Object} LoginManagerOptions
 * @property {import('puppeteer').LaunchOptions} browser - Puppeteer launch options for the browser instance.
 * @property {Credentials} credentials - Account credentials used for login.
 * @property {LoginOptions} login - Options controlling the login flow behaviour.
 * @property {boolean} useDataDir - Whether a persistent user data directory should be used.
 */

/** CourseraLoginManager related events */
const Events = {
    Debug: 'debug'
};

/**
 * Manages browser, page setup and Coursera authentication
 */
class CourseraLoginManager extends EventEmitter {
    static DEFAULT_USER_DATA_DIR = path.join(__dirname, '../../browser');
    static AUTH_COOKIE = 'CAUTH';

    /** @type {LoginManagerOptions} */
    static DEFAULT_OPTS = {
        browser: {
            headless: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--start-maximized',
                '--disable-extensions',
                '--disable-default-apps',
                '--disable-sync',
                '--disable-translate',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-hang-monitor',
                '--disable-prompt-on-repost',
                '--disable-client-side-phishing-detection',
                '--no-first-run',
                '--no-default-browser-check',
                '--metrics-recording-only',
                '--mute-audio',
            ],
            userDataDir: null
        },
        login: {
            timeout: {
                selectors: 30_000,
                login: 30_000,
                page: 30_000
            },
            typingDelay: 60
        },
        useDataDir: true
    };

    /**
     * @param {LoginManagerOptions} options
     * @param {(args: any[]) => void} debugFn - Callback used to emit debug messages
     */
    constructor(options, debugFn) {
        super();

        /** @type {LoginManagerOptions} */
        this.options = options;

        /** @type {(args: any[]) => void} */
        this._debug = debugFn ?? ((...args) => this.emit(Events.Debug, pc.blue(`[debug] [${new Date().toUTCString()}]`), ...args));

        /** @type {import('puppeteer').Browser | null} */
        this.browser = null;

        /** @type {import('puppeteer').Page | null} */
        this.currentPage = null;
    }

    get ready() {
        return !!this.browser && !!this.currentPage;
    }

    async launch() {
        this._debug('Starting browser and initial page...');

        this.browser = await puppeteer.launch(this.options.browser);
        this.currentPage = await this.browser.newPage();

        this._debug('Browser and page successfully opened!');

        await this.#setupInterceptor();
    }

    async close() {
        this.browser?.close();
        this.currentPage?.close();

        this.browser = null;
        this.currentPage = null;
    }

    async isLogged() {
        const cookies = await this.#getCookies();
        return cookies.findIndex((cookie) => cookie.name === CourseraLoginManager.AUTH_COOKIE) > -1;
    }

    async login() {
        this.#mustBeReady();

        this._debug('Starting login attempt...');
        if (await this.isLogged()) {
            this._debug('User already logged in. Skipping login attempt.');
            return;
        }

        await this.currentPage.goto(Constants.LOGIN_PAGE, { waitUntil: 'domcontentloaded' });

        const { login: loginOpts } = this.options;

        // Enter the email address and submit
        this._debug('Waiting for e-mail selector to start typing...');
        await this.currentPage.waitForSelector(Constants.LOGIN_EMAIL_SELECTOR, {
            timeout: loginOpts.timeout.selectors,
            visible: true
        });
        await this.currentPage.focus(Constants.LOGIN_EMAIL_SELECTOR);
        await this.currentPage.type('input[name="email"]', this.options.credentials.email, {
            delay: loginOpts.typingDelay
        });
        await this.currentPage.keyboard.press('Enter');

        // Enter the password and submit
        this._debug('Waiting for password selector to start typing...');
        await this.currentPage.waitForSelector(Constants.LOGIN_PASSWORD_SELECTOR, {
            timeout: loginOpts.timeout.selectors,
            visible: true
        });
        await this.currentPage.focus(Constants.LOGIN_PASSWORD_SELECTOR);
        await this.currentPage.type('input[name="password"]', this.options.credentials.password, {
            delay: loginOpts.typingDelay
        });
        await this.currentPage.keyboard.press('Enter');

        const beforeCookies = await this.#getCookies();
        const result = await Promise.race([
            this.#waitForAuthCookie(loginOpts.timeout.login).then((success) => ({ success })),
            this.currentPage
                .waitForSelector(Constants.LOGIN_FAILED_SELECTOR, { timeout: loginOpts.timeout.login })
                .then(() => ({ success: false }))
        ]);

        if (result.success) {
            this._debug('Login successfully!');

            const afterCookies = await this.#getCookies();
            const addedCookies = differenceBy(afterCookies, beforeCookies, 'name').map((c) => c.name);
            this._debug('Added cookies after login:', addedCookies.join(' | '));
        } else {
            const errorMessage = await this.currentPage.$eval(
                Constants.LOGIN_FAILED_SELECTOR,
                (el) => el.textContent?.trim()
            );
            throw new Error(`Failed to login: ${errorMessage}`);
        }
    }

    async navigateToCourse(courseSlug) {
        this._debug('Navigating to course home...');

        const { page: pageTimeout } = this.options.login.timeout;

        const gradesPromise = this.currentPage.waitForResponse(
            (res) => res.url().includes('/api/onDemandCourseViewGrades.v1/') && res.status() === 200,
            { timeout: pageTimeout }
        );

        await this.currentPage.goto(
            `https://www.coursera.org/learn/${courseSlug}/home/welcome`,
            { waitUntil: 'domcontentloaded', timeout: pageTimeout }
        );

        const gradesRes = await gradesPromise;
        const match = gradesRes.url().match(/onDemandCourseViewGrades\.v1\/(\d+)~([^?]+)/);

        if (match) {
            this._debug(`Resolved ids: userId=${match[1]} courseId=${match[2]}`);
            return { userId: match[1], courseId: match[2] };
        }

        this._debug('Course page loaded!');
        return null;
    }

    async #getCookies() {
        return this.browser.cookies();
    }

    async #waitForAuthCookie(timeout) {
        this.#mustBeReady();
        const start = Date.now();

        while (Date.now() - start < timeout) {
            const cookies = await this.currentPage.cookies();
            if (cookies.some((c) => c.name === CourseraLoginManager.AUTH_COOKIE)) return true;

            await new Promise((resolve) => setTimeout(resolve, 250));
        }

        return false;
    }

    async #setupInterceptor() {
        this.#mustBeReady();
        this._debug('Starting interceptors setup');

        await this.currentPage.setRequestInterception(true);

        this.currentPage.on('request', (req) => {
            const type = req.resourceType();
            if (type === 'ping' || type === 'font' || type === 'eventsource') return req.abort();

            let hostname;
            try {
                hostname = new URL(req.url()).hostname;
            } catch {
                return req.abort();
            }

            if (Constants.BLOCKED_DOMAINS.has(hostname)) return req.abort();
            if (Constants.COURSERA_DOMAINS.has(hostname)) return req.continue();
            if (type === 'script' || type === 'media' || type === 'image') {
                this._debug(`[interceptor] blocked unknown third-party [${type}]: ${hostname}`);
                return req.abort();
            }

            req.continue();
        });
    }

    #mustBeReady() {
        if (!this.ready) throw new Error('Missing initialization of browser or page');
    }
}

module.exports = { CourseraLoginManager, Events };
