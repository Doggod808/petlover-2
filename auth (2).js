import { h, toast } from '../dom.js';
import { api } from '../api.js';

function form({ mode, store, navigate }) {
  const isRegister = mode === 'register';
  const username = h('input', {
    class: 'input input--mono',
    name: 'username',
    autocomplete: 'username',
    required: true,
    minlength: '3',
    maxlength: '20',
    placeholder: '3–20 位字母、数字、_ 或 -',
  });
  const password = h('input', {
    class: 'input',
    name: 'password',
    type: 'password',
    autocomplete: isRegister ? 'new-password' : 'current-password',
    required: true,
    minlength: '8',
    placeholder: '至少 8 位',
  });
  const displayName = isRegister
    ? h('input', { class: 'input', name: 'displayName', maxlength: '24', placeholder: '想让它怎么叫你（可留空）' })
    : null;
  const notice = h('p', { class: 'notice notice--error', hidden: true, role: 'alert' });
  const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, isRegister ? '创建账号' : '登录');

  const el = h(
    'section',
    { class: 'band auth' },
    h(
      'div',
      { class: 'wrap auth__grid' },
      h(
        'div',
        { class: 'auth__copy' },
        h('h1', { class: 'auth__title' }, isRegister ? '先给自己开一间玻璃缸' : '欢迎回来'),
        h(
          'p',
          { class: 'auth__lede' },
          isRegister
            ? '账号只用来区分你的宠物。名字是自己起的，密码不会以明文保存。'
            : '输入账号密码，缸里的那只还在等你喂。',
        ),
        h(
          'ul',
          { class: 'auth__list tiny muted' },
          h('li', {}, '账号名 3–20 位，字母数字下划线或短横线'),
          h('li', {}, '密码至少 8 位，scrypt 加盐后存储'),
          h('li', {}, '一个账号最多养 6 只宠物'),
        ),
      ),
      h(
        'form',
        {
          class: 'auth__form',
          onsubmit: async (event) => {
            event.preventDefault();
            notice.hidden = true;
            submit.disabled = true;
            submit.textContent = isRegister ? '正在开门…' : '正在开门…';
            try {
              const payload = { username: username.value, password: password.value };
              if (isRegister && displayName.value.trim()) payload.displayName = displayName.value.trim();
              const result = isRegister ? await api.register(payload) : await api.login(payload);
              await store.refresh();
              toast(isRegister ? `玻璃缸准备好了，${result.user.username}。` : `欢迎回来，${result.user.username}。`, 'ok');
              navigate('#/den');
            } catch (err) {
              notice.textContent = err.message;
              notice.hidden = false;
              notice.focus?.();
            } finally {
              submit.disabled = false;
              submit.textContent = isRegister ? '创建账号' : '登录';
            }
          },
        },
        notice,
        h('label', { class: 'field' }, h('span', { class: 'field__label' }, '账号'), username),
        isRegister ? h('label', { class: 'field' }, h('span', { class: 'field__label' }, '昵称（可留空）'), displayName) : null,
        h(
          'label',
          { class: 'field' },
          h('span', { class: 'field__label' }, '密码'),
          password,
          h('span', { class: 'field__hint' }, isRegister ? '至少 8 位，建议混上数字和符号。' : ''),
        ),
        submit,
        h(
          'p',
          { class: 'auth__switch tiny' },
          isRegister ? '已经有账号了？' : '还没有账号？',
          ' ',
          h('a', { href: isRegister ? '#/login' : '#/register' }, isRegister ? '去登录' : '去注册'),
        ),
      ),
    ),
  );

  setTimeout(() => username.focus(), 30);
  return { el };
}

export const loginScreen = (ctx) => form({ ...ctx, mode: 'login' });
export const registerScreen = (ctx) => form({ ...ctx, mode: 'register' });
