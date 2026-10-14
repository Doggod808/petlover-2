'use strict';
// POST /api/pets                     新建宠物
// PUT|PATCH /api/pets?id=xxx         改名字/改样子
// DELETE /api/pets?id=xxx            删掉一只
// POST /api/pets?id=xxx&action=activate
module.exports = require('../src/vercel').makeHandler('/api/pets');
