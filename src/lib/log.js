'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'run.log');

/** 只给离线工具用的结构化日志；不进入 Forge 运行时，也不改变评估结果。 */
function log(event, fields = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event,
    ...fields,
  });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, line + '\n');
}

module.exports = { log, LOG_FILE };
