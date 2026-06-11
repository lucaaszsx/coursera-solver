const { CourseraFetcher } = require('./CourseraFetcher');

/**
 * Class responsible for carrying out the course resolution process.
 */
exports.CourseraSolver = class CourseraSolver {
    /** @type {{ userId: string, courseId: string } | null} */
    #courseIds = null;

    /** @type {CourseraFetcher | null} */
    #fetcher = null;

    /**
     * @param {import('./CourseraClient').CourseraClient} client
     */
    constructor(client) {
        this.client = client;
    }

    /**
     * Launches the browser, authenticates, and navigates to the target course
     */
    async start() {
        this.#debug('Starting browser and initial page...');

        const { browserManager } = this.client;

        try {
            await browserManager.launch();
            await browserManager.login();

            this.#courseIds = await browserManager.navigateToCourse(this.options.course);
            if (!this.#courseIds) throw new Error('Failed to resolve userId or courseId during navigation');

            this.#fetcher = new CourseraFetcher(browserManager.currentPage);
        } catch (error) {
            await this.close();
            throw error;
        }
    }

    /**
     * Closes the browser
     */
    async close() {
        await this.browserManager?.close();
        this.client.browserManager = null;
        this.#fetcher = null;
        this.#courseIds = null;
    }

    /**
     * Returns true if the session cookie is present
     */
    async isLogged() {
        return this.client.browserManager.isLogged();
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
        this.client.debug(...args);
    }
}
