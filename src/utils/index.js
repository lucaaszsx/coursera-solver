const { BASE_URL } = require('./constants');

/**
 * Returns homepage of a course using the slug.
 * @param {string} slug - The course slug.
 */
exports.getCourseHomePage = (slug) => `${BASE_URL}/learn/${slug}/home/welcome`;