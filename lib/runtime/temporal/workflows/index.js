'use strict';

const { issueWorkflow } = require('./issue-workflow');
const { recurringScheduleWorkflow } = require('./schedule-workflow');

module.exports = {
  issueWorkflow,
  recurringScheduleWorkflow,
};
