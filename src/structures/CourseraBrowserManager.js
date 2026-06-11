const { differenceBy, merge } = require('lodash');
const { getCourseHomePage } = require('../utils');
const Constants = require('../utils/constants');
const puppeteer = require('puppeteer-extra');
const path = require('node:path');

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
 * @typedef {Object} BrowserManagerOptions
 * @property {import('puppeteer').LaunchOptions} launch - Puppeteer launch options for the browser instance.
 * @property {LoginOptions} login - Options controlling the login flow behaviour.
 * @property {boolean} useDataDir - Whether a persistent user data directory should be used.
 */

/**
 * Manages browser, page setup and Coursera authentication
 */
exports.CourseraBrowserManager = class CourseraBrowserManager {
    static DEFAULT_USER_DATA_DIR = path.join(__dirname, '../../browser');
    static AUTH_COOKIE = 'CAUTH';

    /** @type {BrowserManagerOptions} */
    static DEFAULT_OPTS = {
        launch: {
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
     * @param {import('./CourseraClient').CourseraClient} client
     */
    constructor(client) {
        /** @type {BrowserManagerOptions} */
        this.options = merge({}, CourseraBrowserManager.DEFAULT_OPTS, client.options.browser);

        if (!this.options.launch.userDataDir && this.options.useDataDir)
            this.options.launch.userDataDir = CourseraBrowserManager.DEFAULT_USER_DATA_DIR;
        
        /** @type {Credentials} */
        this.credentials = this.options.credentials;

        /** @type {import('puppeteer').Browser | null} */
        this.browser = null;

        /** @type {import('puppeteer').Page | null} */
        this.currentPage = null;

        /** @type {import('./CourseraClient')} */
        this.client = client;
    }

    get ready() {
        return !!this.browser && !!this.currentPage;
    }

    async launch() {
        this.#debug('Starting browser and initial page...');

        this.browser = await puppeteer.launch(this.options.launch);
        this.currentPage = await this.browser.newPage();

        this.#debug('Browser and page successfully opened!');

        await this.#setupInterceptor();
    }

    async close() {
        this.browser?.close();
        this.currentPage?.close();

        this.browser = null;
        this.currentPage = null;
    }

    async isLogged() {
        this.#mustBeReady();
        const cookies = await this.#getCookies();
        return cookies.findIndex((cookie) => cookie.name === CourseraBrowserManager.AUTH_COOKIE) > -1;
    }

    async login() {
        this.#mustBeReady();
        this.#debug('Starting login attempt...');

        if (await this.isLogged()) {
            this.#debug('User already logged in. Skipping login attempt.');
            return;
        }

        await this.currentPage.goto(Constants.LOGIN_PAGE, { waitUntil: 'domcontentloaded' });

        const { typingDelay, timeout } = this.options.login;
        const beforeCookies = await this.#getCookies();

        // Enter the email address and submit
        this.#debug('Waiting for e-mail selector to start typing...');
        await this.currentPage.waitForSelector(Constants.LOGIN_EMAIL_SELECTOR, {
            timeout: timeout.selectors,
            visible: true
        });
        await this.currentPage.focus(Constants.LOGIN_EMAIL_SELECTOR);
        await this.currentPage.type('input[name="email"]', this.options.credentials.email, {
            delay: typingDelay
        });
        await this.currentPage.keyboard.press('Enter');

        // Enter the password and submit
        this.#debug('Waiting for password selector to start typing...');
        await this.currentPage.waitForSelector(Constants.LOGIN_PASSWORD_SELECTOR, {
            timeout: timeout.selectors,
            visible: true
        });
        await this.currentPage.focus(Constants.LOGIN_PASSWORD_SELECTOR);
        await this.currentPage.type('input[name="password"]', this.options.credentials.password, {
            delay: typingDelay
        });
        await this.currentPage.keyboard.press('Enter');

        const result = await Promise.race([
            this.#waitForAuthCookie(timeout.login).then((success) => ({ success })),
            this.currentPage
                .waitForSelector(Constants.LOGIN_FAILED_SELECTOR, { timeout: timeout.login })
                .then(() => ({ success: false }))
        ]);

        if (result.success) {
            this.#debug('Login successfully!');

            const afterCookies = await this.#getCookies();
            const addedCookies = differenceBy(afterCookies, beforeCookies, 'name').map((c) => c.name);
            this.#debug('Added cookies after login:', addedCookies.join(' | '));
        } else {
            const errorElement = await this.currentPage.$(Constants.LOGIN_FAILED_SELECTOR);

            if (errorElement) {
                const errorMessage = await errorElement.evaluate((el) => el.textContent?.trim());
                throw new Error(`Failed to login: ${errorMessage}`);
            }

            throw new Error('Failed to log in due to an unknown reason');
        }
    }

    async navigateToCourse(courseSlug) {
        this.#mustBeReady();
        this.#debug('Navigating to course home...');

        const { page: pageTimeout } = this.options.login.timeout;

        const gradesPromise = this.currentPage.waitForResponse(
            (res) => res.url().includes('/api/onDemandCourseViewGrades.v1/') && res.status() === 200,
            { timeout: pageTimeout }
        );

        await this.currentPage.goto(
            getCourseHomePage(courseSlug),
            { waitUntil: 'domcontentloaded', timeout: pageTimeout }
        );

        const gradesResponse = await gradesPromise;
        const match = gradesResponse.url().match(/onDemandCourseViewGrades\.v1\/(\d+)~([^?]+)/);

        if (match) {
            this.#debug(`Resolved identifiers: userId=${match[1]} courseId=${match[2]}`);
            return { userId: match[1], courseId: match[2] };
        }

        this.#debug('Course page loaded!');
        return null;
    }

    async #getCookies() {
        return this.browser.cookies();
    }

    async #waitForAuthCookie(timeout) {
        this.#mustBeReady();
        const start = Date.now();

        while (Date.now() - start < timeout) {
            const cookies = await this.#getCookies();
            if (cookies.some((c) => c.name === CourseraBrowserManager.AUTH_COOKIE)) return true;

            await new Promise((resolve) => setTimeout(resolve, 250));
        }

        return false;
    }

    async #setupInterceptor() {
        this.#mustBeReady();
        this.#debug('Starting interceptors setup');

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
                this.#debug(`[interceptor] blocked unknown third-party [${type}]: ${hostname}`);
                return req.abort();
            }

            req.continue();
        });
    }

    #mustBeReady() {
        if (!this.ready) throw new Error('Missing initialization of browser or page');
    }

    #debug(...args) {
        this.client.debug(...args);
    }
}