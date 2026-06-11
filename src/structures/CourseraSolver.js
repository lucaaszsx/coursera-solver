const { CourseraLoginManager } = require('./CourseraLoginManager');
const { CourseraFetcher } = require('./CourseraFetcher');
const { EventEmitter } = require('node:events');
const { merge } = require('lodash');
const pc = require('picocolors');

/**
 * @typedef {Object} Credentials
 * @property {string} email - The account e-mail address.
 * @property {string} password - The account password.
 */

/**
 * @typedef {Object} CourseraSolverOptions
 * @property {import('puppeteer').LaunchOptions} browser - Puppeteer launch options for the browser instance.
 * @property {Credentials} credentials - Account credentials used for login.
 * @property {import('./CourseraLoginManager').LoginOptions} login - Options controlling the login flow behaviour.
 * @property {boolean} useDataDir - Whether a persistent user data directory should be used.
 * @property {string} course - The slug of the course.
 */

/** CourseraSolver related events */
const Events = {
    Debug: 'debug'
};

/**
 * Top-level orchestrator: composes CourseraLoginManager and CourseraFetcher
 * to provide a single entry-point for browser management, authentication,
 * navigation, and course data retrieval.
 */
class CourseraSolver extends EventEmitter {
    /** @type {CourseraSolverOptions} */
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
        useDataDir: true,
        course: null
    };

    /** @type {{ userId: string, courseId: string } | null} */
    #courseIds = null;

    /** @type {CourseraLoginManager | null} */
    #loginManager = null;

    /** @type {CourseraFetcher | null} */
    #fetcher = null;

    /**
     * @param {CourseraSolverOptions} options
     */
    constructor(options = {}) {
        super();

        if (
            !options.credentials ||
            typeof options.credentials.email !== 'string' ||
            typeof options.credentials.password !== 'string'
        )
            throw new TypeError('Missing e-mail or password in "credentials" option');

        /** @type {CourseraSolverOptions} */
        this.options = merge({}, CourseraSolver.DEFAULT_OPTS, options);

        if (!this.options.course) throw new Error('Missing property "course" in options');

        if (!this.options.browser.userDataDir && this.options.useDataDir)
            this.options.browser.userDataDir = CourseraLoginManager.DEFAULT_USER_DATA_DIR;
    }

    get ready() {
        return !!this.#loginManager?.ready;
    }

    /**
     * Launches the browser, authenticates, and navigates to the target course
     */
    async start() {
        this.#debug('Starting browser and initial page...');

        const debugFn = (...args) => this.#debug(...args);
        this.#loginManager = new CourseraLoginManager(this.options, debugFn);

        try {
            await this.#loginManager.launch();
            await this.#loginManager.login();

            this.#courseIds = await this.#loginManager.navigateToCourse(this.options.course);
            if (!this.#courseIds) throw new Error('Failed to resolve userId or courseId during navigation');

            this.#fetcher = new CourseraFetcher(this.#loginManager.currentPage, debugFn);
        } catch (error) {
            await this.close();
            throw error;
        }
    }

    /**
     * Closes the browser
     */
    async close() {
        await this.#loginManager?.close();
        this.#loginManager = null;
        this.#fetcher = null;
        this.#courseIds = null;
    }

    /**
     * Returns true if the session cookie is present
     */
    async isLogged() {
        return this.#loginManager.isLogged();
    }

    /**
     * Fetches all non-passed activities for the configured course
     */
    async fetchPendingActivities() {
        if (!this.#courseIds) throw new Error('Course IDs not resolved. Call start() first.');
        if (!this.#fetcher) throw new Error('Fetcher not initialised. Call start() first.');

        const { userId, courseId } = this.#courseIds;
        this.#debug(`Resolved course: userId=${userId} courseId=${courseId}`);

        return this.#fetcher.fetchPendingActivities(userId, courseId, this.options.course);
    }

    #debug(...args) {
        this.emit(Events.Debug, pc.blue(`[debug] [${new Date().toUTCString()}]`), ...args);
    }
}

module.exports = { CourseraSolver, Events };
