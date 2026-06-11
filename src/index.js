/**const { Command } = require('commander');
const program = new Command()
    .name('cssolver')
    .description('Solve Coursera platform courses automatically.')
    .version(require('../package.json').version)
    .argument('');

program.command('get-pending')
    .description('Get pending activities from the course')
    .action((str, options) => {
        console.log('Getting pending');
    });

program.command('get-finished')
    .description('Get finished activities from the course')
    .action((str, options) => {
        console.log('Getting finished');
    });

program.command('get-all')
    .description('Get all activities from the course')
    .action((str, options) => {
        console.log('Getting all');
    });

program.parse();*/

require('dotenv').config();
const { CourseraClient } = require('./structures/CourseraClient');
const { Events } = require('./utils/events');
const client = new CourseraClient({
    credentials: {
        email: process.env.USER_EMAIL,
        password: process.env.USER_PASSWORD
    },
    course: 'ask-questions-make-decisions'
});

client.on(Events.Debug, (...args) => console.log(...args));

(async () => {
    await client.start();
    console.log(await client.solver.fetchPendingActivities());
    await client.end();
})();
