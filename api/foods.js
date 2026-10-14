'use strict';
// POST /api/foods                    画一份食物
// DELETE /api/foods?id=xxx           丢掉一种
// POST /api/foods?action=daily       领今天的口粮
module.exports = require('../src/vercel').makeHandler('/api/foods');
