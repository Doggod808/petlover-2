import { h, clear, toast, fmtClock, scrollToEnd } from '../dom.js';
import { api } from '../api.js';
import { spriteThumb } from '../paint.js';

const QUICK = ['你好呀', '你饿不饿？', '你在缸里看到什么了？', '我给你换身新颜色好不好'];

export function talkScreen({ store, navigate }) {
  const log = h('div', { class: 'chatlog', role: 'log', 'aria-live': 'polite' });
  const input = h('textarea', {
    class: 'input chat__input',
    rows: '2',
    maxlength: '200',
    placeholder: '说点什么…（回车发送，Shift+回车换行）',
  });
  const sendBtn = h('button', { type: 'submit', class: 'btn btn--primary' }, '说给它听');
  const sourceNote = h('p', { class: 'tiny faint' }, '');
  const petHead = h('div', { class: 'chat__pet' });

  const form = h(
    'form',
    {
      class: 'chat__composer',
      onsubmit: (event) => {
        event.preventDefault();
        send(input.value);
      },
    },
    input,
    h('div', { class: 'chat__composer-row' }, sendBtn, h('span', { class: 'tiny faint' }, '回车发送')),
  );

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send(input.value);
    }
  });

  const quick = h(
    'div',
    { class: 'chat__quick' },
    ...QUICK.map((text) =>
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          onclick: () => {
            input.value = text;
            send(text);
          },
        },
        text,
      ),
    ),
  );

  const el = h(
    'section',
    { class: 'band talk' },
    h(
      'div',
      { class: 'wrap talk__grid' },
      h(
        'div',
        { class: 'talk__main' },
        h('h1', { class: 'page__title' }, '和它说话'),
        petHead,
        log,
        form,
        quick,
      ),
      h(
        'aside',
        { class: 'talk__side' },
        h(
          'div',
          { class: 'panel' },
          h('p', { class: 'label mono' }, '它在拿什么回答你'),
          h(
            'p',
            { class: 'tiny muted' },
            '回答会带上它的名字、画布大小、配色和此刻的饥饿与好感。默认走免费公开接口；接口不通时用本地小脑袋兜底，所以永远不会没有回应。',
          ),
          sourceNote,
        ),
        h(
          'div',
          { class: 'panel' },
          h('p', { class: 'label mono' }, '收拾一下'),
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn--sm btn--ghost',
              onclick: async () => {
                const pet = store.activePet();
                if (!pet) return;
                try {
                  const res = await api.clearChat({ petId: pet.id });
                  store.patch({ chat: res.chat });
                  renderLog();
                  toast('对话清空了。', 'info');
                } catch (err) {
                  toast(err.message, 'error');
                }
              },
            },
            '忘掉刚才聊的',
          ),
        ),
      ),
    ),
  );

  function renderPetHead() {
    clear(petHead);
    const pet = store.activePet();
    if (!pet) {
      petHead.append(h('p', { class: 'muted' }, '还没有宠物，先去画一只。'));
      return;
    }
    petHead.append(
      spriteThumb(pet.sprite, 1, 'thumb'),
      h(
        'div',
        {},
        h('p', { class: 'chat__pet-name' }, pet.name),
        h('p', { class: 'tiny muted mono' }, `${pet.size}×${pet.size} · 饱腹 ${pet.hunger}/100 · 好感 ${pet.affection}/100`),
      ),
    );
  }

  function bubble(message) {
    const mine = message.role === 'user';
    return h(
      'div',
      { class: `bubble ${mine ? 'bubble--me' : 'bubble--pet'}` },
      h('p', { class: 'bubble__text' }, message.content),
      h('span', { class: 'bubble__time tiny mono' }, fmtClock(message.at), message.kind === 'eat' ? ' · 吃东西时说的' : ''),
    );
  }

  function renderLog() {
    clear(log);
    const chat = store.state.chat;
    if (!chat.length) {
      log.append(h('p', { class: 'muted tiny' }, '还没有聊过。试着问它饿不饿。'));
      return;
    }
    for (const message of chat) log.append(bubble(message));
    scrollToEnd(log);
  }

  async function send(raw) {
    const text = String(raw || '').trim();
    const pet = store.activePet();
    if (!text || !pet) return;
    input.value = '';
    sendBtn.disabled = true;
    sendBtn.textContent = '它正在想…';
    const pending = { role: 'user', content: text, at: Date.now() };
    log.append(bubble(pending));
    scrollToEnd(log);
    try {
      const res = await api.chat({ petId: pet.id, text });
      store.patch({
        chat: res.chat,
        pets: store.state.pets.map((item) => (item.id === res.pet.id ? res.pet : item)),
      });
      renderLog();
      renderPetHead();
      sourceNote.textContent =
        res.source === 'ai'
          ? '这一句是模型答的。'
          : `这一句是本地小脑袋答的${res.aiError ? `（模型没通：${res.aiError}）` : ''}。`;
    } catch (err) {
      toast(err.message, 'error');
      pending.failed = true;
      renderLog();
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = '说给它听';
    }
  }

  renderPetHead();
  renderLog();
  setTimeout(() => input.focus(), 40);

  return {
    el,
    update() {
      renderPetHead();
    },
  };
}
