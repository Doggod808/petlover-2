'use strict';
// POST /api/chat                     说一句话
// POST /api/chat?action=clear        忘掉刚才聊的
module.exports = require('../src/vercel').makeHandler('/api/chat');
