import { ICON, element } from './code.js';

export class Picker {
  constructor(choices, label, onPick) {
    this.choices = choices;
    this.value = choices[0][0];
    this.root = element('div', 'picker');
    this.button = element('button', 'chip-button picker-button', `<span></span>${ICON('chevron')}`);
    this.button.type = 'button';
    this.button.setAttribute('aria-haspopup', 'listbox');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.setAttribute('aria-label', label);
    this.list = element('div', 'picker-list');
    this.list.setAttribute('role', 'listbox');
    this.list.hidden = true;
    this.options = choices.map(([value, title]) => {
      const option = element('button', 'picker-option', `${ICON('check')}<span></span>`);
      option.type = 'button';
      option.setAttribute('role', 'option');
      option.dataset.value = value;
      option.querySelector('span').textContent = title;
      return option;
    });
    this.list.append(...this.options);
    this.root.append(this.button, this.list);
    this.set(this.value);

    this.button.addEventListener('click', () => this.open(this.list.hidden));
    this.list.addEventListener('click', event => {
      const option = event.target.closest('[data-value]');
      if (!option) return;
      this.open(false);
      this.button.focus();
      onPick(option.dataset.value);
    });
    this.root.addEventListener('keydown', event => this.key(event));
    document.addEventListener('pointerdown', event => {
      if (!this.root.contains(event.target)) this.open(false);
    });
  }

  set(value) {
    this.value = value;
    const choice = this.choices.find(([key]) => key === value);
    this.button.firstChild.textContent = choice ? choice[1] : value;
    for (const option of this.options) option.setAttribute('aria-selected', String(option.dataset.value === value));
  }

  open(open) {
    this.list.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
    if (open) this.options.find(option => option.dataset.value === this.value).focus();
  }

  key(event) {
    if (event.key === 'Tab') this.open(false);
    if (event.key === 'Escape' && !this.list.hidden) {
      this.open(false);
      this.button.focus();
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    if (this.list.hidden) {
      this.open(true);
      return;
    }
    const index = this.options.indexOf(document.activeElement);
    this.options[(index + (event.key === 'ArrowDown' ? 1 : -1) + this.options.length) % this.options.length].focus();
  }
}
