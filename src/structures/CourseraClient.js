const { CourseraBrowserManager } = require('./CourseraBrowserManager');
const { CourseraSolver } = require('./CourseraSolver');
const { EventEmitter } = require('node:events');
const { Events } = require('../utils/events');
const pc = require('picocolors');

/**
 * @typedef {Object} Credentials
 * @property {string} email - The account e-mail address.
 * @property {string} password - The account password.
 */

/**
 * @typedef {Object} CourseraClientOptions
 * @property {import('./CourseraBrowserManager').BrowserManagerOptions} browser - Options for browser manager.
 * @property {Credentials} credentials - Account credentials used for login.
 * @property {string} course - The slug of the course.
 */

exports.CourseraClient = class CourseraClient extends EventEmitter {
    /**
     * Creates a new instance of CourseraClient.
     * @param {CourseraClientOptions} options - Options for the client.
     */
    constructor(options) {
        super();

        if (
            !options.credentials ||
            typeof options.credentials.email !== 'string' ||
            typeof options.credentials.password !== 'string'
        )
            throw new TypeError('Missing e-mail or password in "credentials" option');
        if (!options.course || typeof options.course !== 'string') throw new Error('Missing property "course" in options');

        /** @type {CourseraClientOptions} */
        this.options = options;

        /** @type {CourseraBrowserManager} */
        this.browserManager = new CourseraBrowserManager(this);
        
        /** @type {import('./CourseraSolver').CourseraSolver} */
        this.solver = new CourseraSolver(this);
    }

    async start() {
        await this.browserManager.launch();
    }

    async end() {
        await this.browserManager.close();
    }

    debug(...args) {
        this.emit(Events.Debug, pc.blue(`[debug] [${new Date().toUTCString()}]`), ...args);
    }
}