'use strict';
// POST /api/auth?action=register | login | logout
module.exports = require('../src/vercel').makeHandler('/api/auth');
