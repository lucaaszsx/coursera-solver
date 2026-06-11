/**
 * @typedef {Object} Activity
 * @property {string} id
 * @property {string} name
 * @property {string} slug
 * @property {string} type
 * @property {string} module
 * @property {string} lesson
 * @property {boolean} passed
 */

class CourseraFetcher {
    /**
     * @param {import('./CourseraClient').CourseraClient} client
     * @param {import('puppeteer').Page} page
    */
   constructor(client, page) {
        /** @type {import('./CourseraClient').CourseraClient} */
        this.client = client;
        
        /** @type {import('puppeteer').Page} */
        this.page = page;
    }

    async getAllActivities(userId, courseId, courseSlug) {
        return this.#fetchAllActivities(userId, courseId, courseSlug);
    }

    async getPendingActivities(userId, courseId, courseSlug) {
        const activities = await this.#fetchAllActivities(userId, courseId, courseSlug);
        return activities.filter((a) => !a.passed);
    }

    async getFinishedActivities(userId, courseId, courseSlug) {
        const activities = await this.#fetchAllActivities(userId, courseId, courseSlug);
        return activities.filter((a) => a.passed);
    }

    async #fetchAllActivities(userId, courseId, courseSlug) {
        this._debug(`Fetching activities for userId=${userId} courseId=${courseId}`);

        const [materials, grades] = await Promise.all([
            this.#get(
                `/api/onDemandCourseMaterials.v2/?q=slug&slug=${courseSlug}` +
                `&includes=modules,lessons,items` +
                `&fields=moduleIds,onDemandCourseMaterialModules.v1(name,slug,lessonIds),` +
                `onDemandCourseMaterialLessons.v1(name,slug,elementIds),` +
                `onDemandCourseMaterialItems.v2(name,slug,contentSummary,isLocked,lockedStatus)`
            ),
            this.#get(
                `/api/onDemandCourseViewGrades.v1/${userId}~${courseId}` +
                `?includes=items&fields=onDemandCourseViewItemGrades.v1(overallOutcome)`
            )
        ]);

        return this.#parseActivities(materials, grades);
    }

    async #get(path) {
        return this.page.evaluate(async (url) => {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`API request failed: ${res.status} ${url}`);
            return res.json();
        }, `https://www.coursera.org${path}`);
    }

    #parseActivities(materials, grades) {
        const linked = materials.linked ?? {};
        const modules = linked['onDemandCourseMaterialModules.v1'] ?? [];
        const lessons = linked['onDemandCourseMaterialLessons.v1'] ?? [];
        const items = linked['onDemandCourseMaterialItems.v2'] ?? [];

        const passedIds = new Set(
            (grades.linked?.['onDemandCourseViewItemGrades.v1'] ?? [])
                .filter((g) => g.overallOutcome === 'passed')
                .map((g) => g.id)
        );

        const itemMap = new Map(items.map((i) => [i.id, i]));
        const lessonMap = new Map(lessons.map((l) => [l.id, l]));
        const result = [];

        for (const module of modules) {
            for (const lessonId of module.lessonIds ?? []) {
                const lesson = lessonMap.get(lessonId);
                if (!lesson) continue;

                for (const elementId of lesson.elementIds ?? []) {
                    const itemId = elementId.replace(/^item~/, '');
                    const item = itemMap.get(itemId);
                    if (!item || item.isLocked) continue;

                    result.push({
                        id: item.id,
                        name: item.name,
                        slug: item.slug,
                        type: item.contentSummary?.typeName ?? 'unknown',
                        module: module.name,
                        lesson: lesson.name,
                        passed: passedIds.has(item.id)
                    });
                }
            }
        }

        return result;
    }
}

module.exports = { CourseraFetcher };
