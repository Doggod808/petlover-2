import { h, clear, toast } from '../dom.js';
import { api } from '../api.js';
import { spriteThumb } from '../paint.js';

export function bagScreen({ store, navigate }) {
  const claimHost = h('div', { class: 'panel__body' });
  const listHost = h('div', { class: 'bag__list' });
  const summary = h('p', { class: 'tiny muted' }, '');

  const el = h(
    'section',
    { class: 'band bag' },
    h(
      'div',
      { class: 'wrap' },
      h('h1', { class: 'page__title' }, '食物袋'),
      h('p', { class: 'page__lede' }, '喂一次消耗一份。食物吃完就从袋子里消失——每日口粮每天都能重新领一份。'),
      h('div', { class: 'bag__grid' }, h('div', { class: 'panel' }, h('p', { class: 'label mono' }, '免费口粮'), claimHost), h('div', { class: 'panel' }, h('p', { class: 'label mono' }, '袋子里'), listHost, summary)),
    ),
  );

  async function claim() {
    try {
      const res = await api.claimDaily();
      store.patch({ foods: res.foods, dailyClaimedToday: true });
      toast('今天的口粮到手了，去喂它吧。', 'ok');
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function feed(food) {
    const pet = store.activePet();
    if (!pet) {
      toast('还没有宠物，先去画一只。', 'error');
      navigate('#/draw?kind=pet');
      return;
    }
    try {
      const res = await api.feed({ petId: pet.id, foodId: food.id });
      store.patch({
        foods: res.foods,
        chat: res.chat,
        pets: store.state.pets.map((item) => (item.id === res.pet.id ? res.pet : item)),
      });
      toast(`${pet.name}：${res.line}`, 'ok', 5000);
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function remove(food) {
    try {
      const res = await api.deleteFood(food.id);
      store.patch({ foods: res.foods });
      toast(`丢掉了「${food.name}」。`, 'info');
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function render() {
    clear(claimHost);
    const claimed = store.state.dailyClaimedToday;
    claimHost.append(
      h('p', { class: 'tiny muted' }, claimed ? '今天的已经领过了，明天零点（北京时间）刷出下一份。' : '每天一份，不领也不会累积成更多。'),
      h(
        'button',
        { type: 'button', class: 'btn btn--sun', disabled: claimed, onclick: claim },
        claimed ? '今天已领过' : '领今天的口粮',
      ),
      h('div', { class: 'bag__hint' }, spriteThumb(store.state.foods.find((f) => f.source === 'daily')?.sprite || null, 2, 'thumb thumb--food')),
    );

    clear(listHost);
    const foods = store.state.foods;
    if (foods.length === 0) {
      listHost.append(
        h(
          'div',
          { class: 'empty empty--slim' },
          h('p', {}, '袋子是空的。'),
          h(
            'div',
            { class: 'empty__actions' },
            h('a', { class: 'btn btn--primary', href: '#/draw?kind=food' }, '画一份食物'),
          ),
        ),
      );
    } else {
      for (const food of foods) {
        listHost.append(
          h(
            'article',
            { class: 'foodcard' },
            spriteThumb(food.sprite, 2, 'thumb thumb--food'),
            h(
              'div',
              { class: 'foodcard__meta' },
              h('h3', { class: 'foodcard__name' }, food.name),
              h(
                'p',
                { class: 'tiny muted mono' },
                `${food.sprite.size}×${food.sprite.size} · 能量 ${food.energy} · 剩 ${food.stock} 份`,
                food.source === 'daily' ? ' · 每日口粮' : '',
              ),
            ),
            h(
              'div',
              { class: 'foodcard__ops' },
              h('button', { type: 'button', class: 'btn btn--sm btn--primary', onclick: () => feed(food) }, '喂给它'),
              h('button', { type: 'button', class: 'btn btn--sm btn--ghost', onclick: () => remove(food) }, '丢掉'),
            ),
          ),
        );
      }
    }
    const total = foods.reduce((sum, food) => sum + (food.stock || 0), 0);
    summary.textContent = `共 ${foods.length} 种、${total} 份食物。`;
  }

  render();
  return { el, update: render };
}
