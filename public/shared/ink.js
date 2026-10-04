const NS = 'http://www.w3.org/2000/svg';
const TAU = Math.PI * 2;
const COLORS = ['var(--ink)', '#3987e5', '#eb6834', '#1baf7a', '#e87ba4', '#9085e9', '#e34948', '#eda100'];
const SPEED = 520;
const GAP = 60;
const calm = matchMedia('(prefers-reduced-motion: reduce)');

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.codePointAt(0), 16777619);
  return value >>> 0;
}

function resample(points, step) {
  const out = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const length = Math.hypot(x1 - x0, y1 - y0);
    let distance = step - carry;
    while (distance <= length) {
      out.push([x0 + (x1 - x0) * distance / length, y0 + (y1 - y0) * distance / length]);
      distance += step;
    }
    carry = length - (distance - step);
  }
  const last = points[points.length - 1];
  const tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > step * 0.3) out.push(last);
  return out;
}

export function arc(cx, cy, rx, ry, from, to, count = 48) {
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = from + (to - from) * index / count;
    return [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)];
  });
}

export function bezier(p0, p1, p2, p3, count = 32) {
  return Array.from({ length: count + 1 }, (_, index) => {
    const t = index / count;
    const u = 1 - t;
    return [0, 1].map(axis => u * u * u * p0[axis] + 3 * u * u * t * p1[axis] + 3 * u * t * t * p2[axis] + t * t * t * p3[axis]);
  });
}

export function spline(points, closed = false, count = 12) {
  const list = closed ? [points[points.length - 1], ...points, points[0], points[1]] : [points[0], ...points, points[points.length - 1]];
  const out = [];
  for (let i = 1; i < list.length - 2; i++) {
    const [p0, p1, p2, p3] = [list[i - 1], list[i], list[i + 1], list[i + 2]];
    for (let step = 0; step < count; step++) {
      const t = step / count;
      out.push([0, 1].map(axis => 0.5 * (2 * p1[axis] + (p2[axis] - p0[axis]) * t
        + (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t * t
        + (3 * p1[axis] - p0[axis] - 3 * p2[axis] + p3[axis]) * t * t * t)));
    }
  }
  out.push(closed ? out[0] : points[points.length - 1]);
  return out;
}

export function roundRect(x, y, w, h, r) {
  const corner = (cx, cy, from) => arc(cx, cy, r, r, from, from + Math.PI / 2, 8);
  return [
    [x + w / 2, y],
    ...corner(x + w - r, y + r, -Math.PI / 2),
    ...corner(x + w - r, y + h - r, 0),
    ...corner(x + r, y + h - r, Math.PI / 2),
    ...corner(x + r, y + r, Math.PI),
    [x + w / 2, y]
  ];
}

export function astroid(cx, cy, r) {
  return Array.from({ length: 49 }, (_, index) => {
    const angle = TAU * index / 48;
    return [cx + r * Math.cos(angle) ** 3, cy + r * Math.sin(angle) ** 3];
  });
}

export function heart(cx, cy, size) {
  const scale = size / 32;
  return Array.from({ length: 49 }, (_, index) => {
    const t = TAU * index / 48;
    return [cx + 16 * Math.sin(t) ** 3 * scale, cy - (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * scale];
  });
}

export function wave(x0, x1, y, amplitude, period) {
  return Array.from({ length: 25 }, (_, index) => {
    const x = x0 + (x1 - x0) * index / 24;
    return [x, y + amplitude * Math.sin(TAU * (x - x0) / period)];
  });
}

export class Pen {
  constructor(name, jitter = 1) {
    this.random = random(hash(name));
    this.jitter = jitter;
    this.strokes = [];
  }

  line(color, width, points, { closed = false, wobble = 1, step = 3.5 } = {}) {
    let path = resample(points, step);
    const amplitude = this.jitter * wobble;
    const phase = [this.random() * TAU, this.random() * TAU];
    const frequency = [0.8 + this.random() * 0.7, 2 + this.random() * 1.6];
    let total = 0;
    const along = path.map((point, index) => (total += index ? Math.hypot(point[0] - path[index - 1][0], point[1] - path[index - 1][1]) : 0));
    const cycles = Math.max(1, total / 180);
    path = path.map(([x, y], index) => {
      const previous = path[Math.max(0, index - 1)];
      const next = path[Math.min(path.length - 1, index + 1)];
      const dx = next[0] - previous[0];
      const dy = next[1] - previous[1];
      const norm = Math.hypot(dx, dy) || 1;
      const u = along[index] / (total || 1);
      const offset = amplitude * (0.65 * Math.sin(TAU * frequency[0] * u * cycles + phase[0]) + 0.35 * Math.sin(TAU * frequency[1] * u * cycles + phase[1]));
      return [x - dy / norm * offset, y + dx / norm * offset];
    });
    if (closed) {
      const extra = path.slice(1, Math.max(3, Math.round(path.length * 0.06)));
      path = [...path, ...extra.map(([x, y], index) => [x + (index + 1) * 0.25 * this.jitter, y - (index + 1) * 0.15 * this.jitter])];
    }
    this.strokes.push({ color, width, points: path });
    return this;
  }

  dot(color, size, x, y) {
    this.strokes.push({ color, width: size, points: [[x, y]] });
    return this;
  }
}

function pathData(points) {
  const round = value => Math.round(value * 10) / 10;
  if (points.length === 1) return `M${round(points[0][0])} ${round(points[0][1])}l0.01 0`;
  let d = `M${round(points[0][0])} ${round(points[0][1])}`;
  for (let i = 1; i < points.length - 1; i++) {
    d += `Q${round(points[i][0])} ${round(points[i][1])} ${round((points[i][0] + points[i + 1][0]) / 2)} ${round((points[i][1] + points[i + 1][1]) / 2)}`;
  }
  const last = points[points.length - 1];
  return d + `L${round(last[0])} ${round(last[1])}`;
}

export function render(svg, strokes, hidden) {
  svg.replaceChildren(...strokes.map(stroke => {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', pathData(stroke.points));
    path.setAttribute('stroke-width', String(stroke.width));
    path.style.stroke = COLORS[stroke.color];
    if (hidden) path.style.opacity = '0';
    return path;
  }));
}

export function draw(svg, delay = 0) {
  if (calm.matches) {
    svg.querySelectorAll('path').forEach(path => {
      path.style.opacity = '';
    });
    return 0;
  }
  const box = svg.viewBox.baseVal;
  const scale = box && box.width ? svg.clientWidth / box.width : 1;
  let at = delay;
  for (const path of svg.querySelectorAll('path')) {
    const length = Math.max(0.5, path.getTotalLength());
    const duration = Math.max(90, length * scale / SPEED * 1000);
    path.style.strokeDasharray = `${length} ${length}`;
    path.style.strokeDashoffset = String(length);
    path.style.opacity = '';
    path.animate([{ strokeDashoffset: length }, { strokeDashoffset: 0 }], { duration, delay: at, easing: 'cubic-bezier(.4, .05, .3, 1)', fill: 'forwards' });
    at += duration + GAP;
  }
  return at;
}

function sketchOf(name, design) {
  const pen = new Pen(name, design.jitter);
  design.paint(pen);
  return pen.strokes;
}

export function mountSketches(designs, placements) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      draw(entry.target, 150);
    }
  }, { threshold: 0.55 });
  for (const [id, name] of Object.entries(placements)) {
    const section = document.getElementById(id);
    const design = designs[name];
    if (!section || !design) continue;
    const host = id === 'top' ? section.querySelector('.wrap') : section.querySelector('.chapter-head');
    if (!host) continue;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${design.size[0]} ${design.size[1]}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('sketch');
    if (id === 'top') svg.classList.add('hero-sketch');
    host.append(svg);
    render(svg, sketchOf(name, design), !calm.matches);
    observer.observe(svg);
  }
}

function markStrokes(kind, width, height, seed) {
  const pen = new Pen(seed, 1.1);
  const weight = Math.min(4.5, Math.max(2.2, height / 30));
  if (kind === 'circle') {
    pen.line(2, weight, arc(width / 2, height / 2, width / 2 - weight, height / 2 - weight, Math.PI * 0.95, Math.PI * 3.12, 72), { wobble: 1.4 });
  } else if (kind === 'zigzag') {
    const count = Math.max(4, Math.round(width / 14));
    pen.line(6, 2.4, Array.from({ length: count + 1 }, (_, index) => [6 + (width - 12) * index / count, height - 5 + (index % 2 ? -5 : 3)]), { wobble: 0.5, step: 2.5 });
  } else if (kind === 'underline') {
    pen.line(1, Math.min(6, Math.max(3, height / 4)), bezier([2, height * 0.6], [width * 0.35, height * 0.95], [width * 0.7, height * 0.25], [width - 2, height * 0.55]), { wobble: 0.8 });
  } else {
    pen.line(3, 2.6, bezier([4, height - 4], [width * 0.35, height - 1], [width * 0.7, height - 7], [width - 4, height - 5]), { wobble: 0.8 });
  }
  return pen.strokes;
}

export function mark(target, kind, delay = 0) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('mark-ink', kind);
  target.append(svg);
  const paint = animate => {
    const width = svg.clientWidth;
    const height = svg.clientHeight;
    if (!width || !height) return;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    render(svg, markStrokes(kind, width, height, target.textContent), animate && !calm.matches);
    if (animate) draw(svg, delay);
  };
  document.fonts.ready.then(() => paint(true));
  let sized = false;
  const observer = new ResizeObserver(() => {
    if (!svg.isConnected) {
      observer.disconnect();
      return;
    }
    if (sized) paint(false);
    sized = true;
  });
  observer.observe(target);
  return svg;
}

export function markOnSight(elements, kind, gap = 350) {
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).map(entry => entry.target);
    visible.forEach((target, index) => {
      observer.unobserve(target);
      mark(target, kind, 200 + index * gap);
    });
  }, { threshold: 0.9 });
  elements.forEach(element => observer.observe(element));
}

export function markVerdicts() {
  const watch = new MutationObserver(records => {
    for (const record of records) {
      const box = record.target;
      if (!box.classList || !box.classList.contains('verdict') || !box.classList.contains('shown')) continue;
      const text = box.querySelector(':scope > span');
      if (!text || text.querySelector('.mark-ink')) continue;
      mark(text, box.classList.contains('bad') ? 'zigzag' : 'ok', 280);
    }
  });
  watch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
}
