import { h, clear, toast } from '../dom.js';
import { api } from '../api.js';
import { createEditor } from '../editor.js';
import { PET_SIZES, FOOD_SIZES, blankSprite, resizeTo, toStored, fromStored } from '../sprite.js';
import { PRESETS, FOOD_PRESETS } from '../presets.js';

export function drawScreen({ store, navigate, params }) {
  const kind = params.get('kind') === 'food' ? 'food' : 'pet';
  const sizes = kind === 'food' ? FOOD_SIZES : PET_SIZES;
  const editingId = params.get('id');
  const existingPet = editingId ? store.state.pets.find((pet) => pet.id === editingId) : null;

  let size = existingPet ? existingPet.size : (kind === 'food' ? 16 : 32);
  let working = existingPet ? fromStored(existingPet.sprite) : blankSprite(size);
  let saved = Boolean(existingPet);

  const nameInput = h('input', {
    class: 'input',
    maxlength: '16',
    value: existingPet ? existingPet.name : '',
    placeholder: kind === 'food' ? '比如：草莓饼干' : '比如：苔苔',
  });

  const dirtyNote = h('p', { class: 'tiny faint' }, '');
  const saveBtn = h('button', { type: 'button', class: 'btn btn--primary' }, saved ? '保存改动' : '保存');

  function dirty() {
    dirtyNote.textContent = saved ? '有改动还没保存。' : '还没保存。';
  }

  const editor = createEditor({
    size,
    sprite: existingPet ? fromStored(existingPet.sprite) : null,
    presets: kind === 'food' ? FOOD_PRESETS : PRESETS,
    onChange: (current) => {
      working = current;
      dirty();
    },
  });

  const sizeRow = h('div', { class: 'sizer' });

  function renderSizes() {
    clear(sizeRow);
    for (const option of sizes) {
      sizeRow.append(
        h(
          'button',
          {
            type: 'button',
            class: 'chip',
            'aria-pressed': String(option === size),
            onclick: () => {
              if (option === size) return;
              size = option;
              const next = resizeTo(working, option);
              editor.setSprite(next);
              renderSizes();
            },
          },
          `${option}×${option}`,
        ),
      );
    }
  }

  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim() || (kind === 'food' ? '随手画的' : '无名');
    const payload = { name, sprite: toStored(working) };
    saveBtn.disabled = true;
    try {
      if (kind === 'food') {
        const res = await api.saveFood(payload);
        store.patch({ foods: res.foods });
        toast(res.stacked ? `「${name}」又多了一份。` : `「${name}」放进食物袋了。`, 'ok');
        navigate('#/bag');
        return;
      }
      if (existingPet) {
        const res = await api.updatePet(existingPet.id, payload);
        store.patch({ pets: store.state.pets.map((pet) => (pet.id === res.pet.id ? res.pet : pet)) });
        toast(`${res.pet.name} 的样子更新了。`, 'ok');
      } else {
        const res = await api.savePet(payload);
        await store.refresh();
        toast(`${res.pet.name} 已经站进玻璃缸了。`, 'ok');
      }
      navigate('#/den');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      saveBtn.disabled = false;
    }
  });

  const el = h(
    'section',
    { class: 'band draw' },
    h(
      'div',
      { class: 'wrap' },
      h('h1', { class: 'page__title' }, kind === 'food' ? '画一份食物' : existingPet ? `改 ${existingPet.name} 的样子` : '画一只宠物'),
      h(
        'p',
        { class: 'page__lede' },
        kind === 'food'
          ? '食物也吃像素：颜色越丰富、涂得越满，它吃下去越顶饱。同名同尺寸的食物会叠成一份。'
          : '画布越大越好发挥，但 32 格最考验造型。透视不过关没关系，这里只讲究看着像。',
      ),
      h(
        'div',
        { class: 'draw__toolbar panel' },
        h('div', { class: 'draw__field' }, h('p', { class: 'label mono' }, '画布'), sizeRow),
        h('label', { class: 'draw__field draw__field--grow' }, h('span', { class: 'label mono' }, kind === 'food' ? '食物名字' : '宠物名字'), nameInput),
        h('div', { class: 'draw__field' }, h('p', { class: 'label mono' }, '保存'), saveBtn, dirtyNote),
      ),
      editor.el,
      h(
        'p',
        { class: 'tiny faint draw__foot' },
        kind === 'pet'
          ? '一个账号最多养 6 只宠物。想换造型就用「改它的样子」，或者干脆新画一只。'
          : '画好的食物会立刻进食物袋，能马上喂。',
      ),
    ),
  );

  renderSizes();
  setTimeout(() => nameInput.focus(), 40);

  return {
    el,
    destroy() {
      editor.destroy();
    },
  };
}
