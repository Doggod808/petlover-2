import { h, clear, toast, relTime, fmtNum, append } from '../dom.js';
import { api } from '../api.js';
import { createTerrarium } from '../terrarium.js';
import { spriteThumb } from '../paint.js';

const POKE_LINES = [
  '{name}往旁边挪了半格，把最绿的那块草让给你。',
  '{name}抬头看了你一眼，又低头继续发呆。',
  '{name}原地弹了一下，算是打过招呼。',
  '缸里起了一阵小风，{name}的边角抖了抖。',
];

function meter(label, value, kind) {
  const fill = h('div', { class: `meter__fill meter__fill--${kind}` });
  fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
  return h(
    'div',
    { class: 'meter' },
    h(
      'div',
      { class: 'meter__head' },
      h('span', {}, label),
      h('span', { class: 'mono' }, `${Math.round(value)}/100`),
    ),
    h('div', { class: 'meter__track' }, fill),
  );
}

export function denScreen({ store, navigate }) {
  const stage = h('div', { class: 'terrarium-host' });
  const stageLine = h('p', { class: 'stagebar__line mono tiny' }, '');
  const pokeBtn = h('button', { type: 'button', class: 'btn btn--sm btn--ghost' }, '摸摸它');
  const stageBar = h('div', { class: 'stagebar' }, stageLine, pokeBtn);
  const head = h('p', { class: 'den__hello' }, '');
  const sideHost = h('div', { class: 'den__side-inner' });
  const bodyHost = h('div', { class: 'den__body' });

  let terrarium = null;
  let currentPetId = null;

  const el = h(
    'section',
    { class: 'band den' },
    h(
      'div',
      { class: 'wrap den__grid' },
      h(
        'div',
        { class: 'den__stage' },
        head,
        stage,
        stageBar,
        bodyHost,
      ),
      h('aside', { class: 'den__side' }, sideHost),
    ),
  );

  pokeBtn.addEventListener('click', () => {
    const pet = store.activePet();
    if (!pet || !terrarium) return;
    terrarium.poke();
    stageLine.textContent = POKE_LINES[Math.floor(Math.random() * POKE_LINES.length)].replace('{name}', pet.name);
  });

  function mountTerrarium(pet) {
    if (terrarium) terrarium.destroy();
    clear(stage);
    terrarium = createTerrarium(stage, {
      sprite: pet.sprite,
      interactive: true,
      onPoke: () => {
        stageLine.textContent = POKE_LINES[Math.floor(Math.random() * POKE_LINES.length)].replace('{name}', pet.name);
      },
    });
    terrarium.setMood({ hunger: pet.hunger, affection: pet.affection });
    currentPetId = pet.id;
  }

  function emptyState() {
    return h(
      'div',
      { class: 'empty' },
      h('h2', {}, '玻璃缸里还空着'),
      h('p', { class: 'muted' }, '画一只宠物，它就会站在草地上等你。不会画也没关系，进了画板可以用现成模板改。'),
      h(
        'div',
        { class: 'empty__actions' },
        h('a', { class: 'btn btn--primary', href: '#/draw?kind=pet' }, '去画一只'),
        h('a', { class: 'btn btn--ghost', href: '#/bag' }, '先看看食物袋'),
      ),
    );
  }

  function renderBody(pet) {
    clear(bodyHost);
    if (!pet) {
      bodyHost.append(emptyState());
      return;
    }
    bodyHost.append(
      h(
        'div',
        { class: 'den__actions' },
        h('a', { class: 'btn btn--primary', href: '#/talk' }, `和${pet.name}说话`),
        h('a', { class: 'btn', href: `#/draw?kind=pet&id=${pet.id}` }, '改它的样子'),
        h('a', { class: 'btn btn--ghost', href: '#/draw?kind=pet' }, '再画一只'),
        h('a', { class: 'btn btn--ghost', href: '#/bag' }, '食物袋'),
      ),
    );
  }

  function renderFoods(pet) {
    const foods = store.state.foods;
    if (foods.length === 0) {
      return h(
        'div',
        { class: 'quickfood' },
        h('p', { class: 'label mono' }, '喂它'),
        h('p', { class: 'tiny muted' }, '食物袋空了。先去领今天的免费口粮，或者自己画一份。'),
        h(
          'div',
          { class: 'quickfood__row' },
          claimButton(),
          h('a', { class: 'btn btn--sm btn--ghost', href: '#/draw?kind=food' }, '画一份'),
        ),
      );
    }
    return h(
      'div',
      { class: 'quickfood' },
      h('p', { class: 'label mono' }, '喂它'),
      h(
        'div',
        { class: 'quickfood__row' },
        ...foods.slice(0, 6).map((food) =>
          h(
            'button',
            {
              type: 'button',
              class: 'foodchip',
              title: `${food.name} · 能量 ${food.energy}${food.stock > 1 ? ` · 还有 ${food.stock} 份` : ''}`,
              onclick: () => feed(pet, food),
            },
            spriteThumb(food.sprite, 2, 'thumb thumb--food'),
            h('span', { class: 'foodchip__name tiny' }, food.name),
            food.stock > 1 ? h('span', { class: 'foodchip__stock mono' }, `×${food.stock}`) : null,
          ),
        ),
      ),
      h(
        'div',
        { class: 'quickfood__row' },
        claimButton(),
        h('a', { class: 'btn btn--sm btn--ghost', href: '#/bag' }, '全部食物'),
      ),
    );
  }

  function claimButton() {
    const claimed = store.state.dailyClaimedToday;
    return h(
      'button',
      {
        type: 'button',
        class: 'btn btn--sm btn--sun',
        disabled: claimed,
        onclick: async () => {
          try {
            const res = await api.claimDaily();
            store.patch({ foods: res.foods, dailyClaimedToday: true });
            toast('今天的口粮到手了。', 'ok');
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      },
      claimed ? '今天已领过' : '领今天的口粮',
    );
  }

  async function feed(pet, food) {
    if (!terrarium) return;
    try {
      const res = await api.feed({ petId: pet.id, foodId: food.id });
      store.patch({
        foods: res.foods,
        chat: res.chat,
        pets: store.state.pets.map((item) => (item.id === res.pet.id ? res.pet : item)),
      });
      terrarium.setMood({ hunger: res.pet.hunger, affection: res.pet.affection });
      terrarium.feed();
      stageLine.textContent = res.line;
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function renderSide(pet) {
    clear(sideHost);
    if (!pet) {
      sideHost.append(
        h(
          'div',
          { class: 'panel' },
          h('p', { class: 'label mono' }, '先做点什么'),
          h(
            'p',
            { class: 'tiny muted' },
            '宠物还没画，但今天的免费口粮可以先领——等它站进玻璃缸，你就有一份现成的点心。',
          ),
          h('div', { class: 'quickfood__row' }, claimButton()),
        ),
        h('p', { class: 'tiny faint' }, '画完之后，这里会显示它的饱腹与好感。'),
      );
      return;
    }
    append(sideHost, [
      h(
        'div',
        { class: 'panel' },
        h('p', { class: 'label mono' }, '它现在的状态'),
        meter('饱腹', pet.hunger, 'hunger'),
        meter('好感', pet.affection, 'love'),
        h(
          'dl',
          { class: 'facts' },
          h('div', {}, h('dt', {}, '画布'), h('dd', { class: 'mono' }, `${pet.size}×${pet.size}`)),
          h('div', {}, h('dt', {}, '上次进食'), h('dd', {}, relTime(pet.lastFedAt))),
          h('div', {}, h('dt', {}, '喂过'), h('dd', { class: 'mono' }, `${fmtNum(pet.fedCount)} 次`)),
          h('div', {}, h('dt', {}, '状态'), h('dd', {}, pet.hungerWord)),
        ),
      ),
      renderFoods(pet),
      store.state.pets.length > 1
        ? h(
            'div',
            { class: 'panel' },
            h('p', { class: 'label mono' }, '缸里的其他宠物'),
            h(
              'div',
              { class: 'petstrip' },
              ...store.state.pets
                .filter((item) => item.id !== pet.id)
                .map((item) =>
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'petstrip__item',
                      onclick: async () => {
                        try {
                          const state = await api.activatePet(item.id);
                          store.fromState(state);
                        } catch (err) {
                          toast(err.message, 'error');
                        }
                      },
                    },
                    spriteThumb(item.sprite, 1, 'thumb'),
                    h('span', { class: 'tiny' }, item.name),
                  ),
                ),
            ),
          )
        : null,
      h(
        'p',
        { class: 'tiny faint' },
        store.state.ai && store.state.ai.offline
          ? '当前是本地小脑袋模式，它只能聊缸里的事。'
          : `对话通道：${store.state.ai?.provider || '未知'}。`,
      ),
    ]);
  }

  function render() {
    const pet = store.activePet();
    head.textContent = pet
      ? `${store.state.user.displayName}，${pet.name} 在等你。今天是 ${store.state.today}。`
      : `${store.state.user.displayName}，今天是 ${store.state.today}。`;
    if (pet && pet.id !== currentPetId) {
      stage.hidden = false;
      stageBar.hidden = false;
      mountTerrarium(pet);
      stageLine.textContent = '草长得有点高了，它站在中间只露出半截。';
    } else if (pet && terrarium) {
      stage.hidden = false;
      stageBar.hidden = false;
      terrarium.setMood({ hunger: pet.hunger, affection: pet.affection });
    } else {
      stage.hidden = true;
      stageBar.hidden = true;
    }
    renderBody(pet);
    renderSide(pet);
  }

  render();
  return {
    el,
    update() {
      render();
    },
    destroy() {
      if (terrarium) terrarium.destroy();
    },
  };
}
