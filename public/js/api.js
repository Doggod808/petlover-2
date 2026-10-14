/** 所有后端调用集中在这里，统一抛错、统一带 Cookie。 */

async function call(method, route, body) {
  const options = {
    method,
    headers: {},
    credentials: 'same-origin',
  };
  if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(route, options);
  } catch (err) {
    throw new Error('连不上服务器，确认站点还在运行。');
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `请求失败（${res.status}）`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  status: () => call('GET', '/api/status'),
  me: () => call('GET', '/api/me'),
  state: () => call('GET', '/api/state'),
  // 路由里可变的部分一律走查询串：本机（server.js）和 Vercel（api/*.js）都认这一套
  register: (payload) => call('POST', '/api/auth?action=register', payload),
  login: (payload) => call('POST', '/api/auth?action=login', payload),
  logout: () => call('POST', '/api/auth?action=logout'),
  savePet: (payload) => call('POST', '/api/pets', payload),
  updatePet: (id, payload) => call('PUT', `/api/pets?id=${encodeURIComponent(id)}`, payload),
  deletePet: (id) => call('DELETE', `/api/pets?id=${encodeURIComponent(id)}`),
  activatePet: (id) => call('POST', `/api/pets?action=activate&id=${encodeURIComponent(id)}`),
  saveFood: (payload) => call('POST', '/api/foods', payload),
  deleteFood: (id) => call('DELETE', `/api/foods?id=${encodeURIComponent(id)}`),
  claimDaily: () => call('POST', '/api/foods?action=daily'),
  feed: (payload) => call('POST', '/api/feed', payload),
  chat: (payload) => call('POST', '/api/chat', payload),
  clearChat: (payload) => call('POST', '/api/chat?action=clear', payload),
};
