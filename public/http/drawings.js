import { arc, astroid, bezier, heart, roundRect, spline, wave } from './ink.js';

const ICON = [160, 120];
const HERO = [520, 320];

function sparkle(pen, x, y, r) {
  pen.line(7, 2.2, astroid(x, y, r), { closed: true, wobble: 0.3, step: 2 });
}

function arrowHead(pen, color, width, tip, from, size = 9) {
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  pen.line(color, width, [
    [tip[0] - size * Math.cos(angle - 0.5), tip[1] - size * Math.sin(angle - 0.5)],
    tip,
    [tip[0] - size * Math.cos(angle + 0.5), tip[1] - size * Math.sin(angle + 0.5)]
  ], { wobble: 0.3 });
}

function arrow(pen, color, from, to, bend = 0) {
  const middle = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 + bend];
  const points = spline([from, middle, to], false, 10);
  pen.line(color, 2.2, points, { wobble: 0.4 });
  arrowHead(pen, color, 2.2, to, points[points.length - 3]);
}

function dashed(pen, color, points, dash = 11, gap = 8) {
  let segment = [points[0]];
  let run = 0;
  let drawing = true;
  for (let i = 1; i < points.length; i++) {
    run += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    if (drawing) segment.push(points[i]);
    if (drawing && run >= dash) {
      pen.line(color, 1.8, segment, { wobble: 0.2, step: 2 });
      drawing = false;
      run = 0;
    } else if (!drawing && run >= gap) {
      drawing = true;
      run = 0;
      segment = [points[i]];
    }
  }
  if (drawing && segment.length > 1) pen.line(color, 1.8, segment, { wobble: 0.2, step: 2 });
}

function folder(pen, color, x, y, w, h) {
  const tab = Math.min(34, w * 0.36);
  pen.line(color, 2.4, [
    [x, y + 8], [x + 4, y], [x + tab - 6, y], [x + tab, y + 9], [x + w - 4, y + 9], [x + w, y + 14],
    [x + w, y + h - 4], [x + w - 4, y + h], [x + 4, y + h], [x, y + h - 4], [x, y + 8]
  ], { closed: true, wobble: 0.6 });
  pen.line(color, 2, [[x, y + 20], [x + w, y + 20]], { wobble: 0.4 });
}

function sheet(pen, color, x, y, w, h) {
  pen.line(color, 2.2, [[x, y], [x + w - 10, y], [x + w, y + 10], [x + w, y + h], [x, y + h], [x, y]], { closed: true, wobble: 0.4 });
  pen.line(color, 1.6, [[x + w - 10, y], [x + w - 10, y + 10], [x + w, y + 10]], { wobble: 0.2 });
  for (let row = 1; row <= Math.floor((h - 12) / 9); row++) {
    pen.line(color, 1.6, wave(x + 6, x + w - 8, y + 8 + row * 9, 0.8, 12), { wobble: 0.2 });
  }
}

function two(pen, color, x, y, s) {
  pen.line(color, 2.6, spline([[x - 6 * s, y - 7 * s], [x - 1 * s, y - 13 * s], [x + 6 * s, y - 9 * s], [x + 5 * s, y - 1 * s], [x - 6 * s, y + 12 * s], [x + 7 * s, y + 12 * s]], false, 6), { wobble: 0.3, step: 2 });
}

function zero(pen, color, x, y, s) {
  pen.line(color, 2.6, arc(x, y, 7 * s, 12.5 * s, -Math.PI / 2, 1.5 * Math.PI, 28), { closed: true, wobble: 0.3, step: 2 });
}

function tower(pen, x, y, w, h) {
  pen.line(0, 2.6, roundRect(x, y, w, h, 10), { closed: true });
  const rows = 4;
  for (let index = 1; index < rows; index++) pen.line(0, 2, [[x, y + h * index / rows], [x + w, y + h * index / rows]], { wobble: 0.3 });
  for (let index = 0; index < rows; index++) {
    const middle = y + h * (index + 0.5) / rows;
    pen.dot(index === 1 ? 2 : 3, 6, x + 16, middle);
    pen.line(0, 1.8, [[x + 34, middle], [x + w - 14, middle]], { wobble: 0.2 });
  }
}

export const DRAWINGS = {
  'http-hero': {
    size: HERO,
    jitter: 1.2,
    paint(pen) {
      tower(pen, 30, 70, 104, 196);
      [[178, 132], [222, 120], [266, 128]].forEach(([x, y], index) => {
        pen.line([1, 5, 1][index], 2.2, roundRect(x, y, 30, 22, 4), { closed: true, wobble: 0.4 });
        pen.line([1, 5, 1][index], 1.6, [[x + 6, y + 11], [x + 24, y + 11]], { wobble: 0.2 });
      });
      dashed(pen, 5, bezier([140, 170], [180, 220], [300, 210], [342, 156], 40));
      arrowHead(pen, 5, 2, [342, 156], [334, 168]);
      sheet(pen, 0, 372, 84, 54, 66);
      folder(pen, 1, 344, 122, 150, 110);
      two(pen, 3, 382, 42, 1.4);
      zero(pen, 3, 412, 42, 1.4);
      zero(pen, 3, 440, 42, 1.4);
      pen.line(3, 2.6, [[466, 40], [476, 52], [498, 22]], { wobble: 0.3 });
      pen.line(4, 2.2, heart(206, 60, 20), { closed: true, wobble: 0.3, step: 2 });
      sparkle(pen, 318, 64, 10);
      sparkle(pen, 500, 260, 9);
      sparkle(pen, 162, 282, 7);
    }
  },
  folder: {
    size: ICON,
    paint(pen) {
      sheet(pen, 0, 60, 14, 40, 44);
      folder(pen, 1, 38, 40, 86, 66);
      arrow(pen, 5, [6, 30], [42, 56], -10);
      arrow(pen, 3, [118, 56], [154, 30], -10);
      sparkle(pen, 146, 96, 7);
    }
  },
  scissors: {
    size: ICON,
    paint(pen) {
      pen.line(0, 2.2, roundRect(6, 80, 66, 18, 3), { closed: true, wobble: 0.3 });
      [20, 34, 48, 62].forEach(x => pen.line(0, 1.6, [[x, 81], [x, 97]], { wobble: 0.1 }));
      pen.line(1, 2.2, roundRect(88, 86, 66, 18, 3), { closed: true, wobble: 0.3 });
      [102, 116, 130, 144].forEach(x => pen.line(1, 1.6, [[x, 87], [x, 103]], { wobble: 0.1 }));
      dashed(pen, 6, [[80, 62], [80, 112]], 7, 6);
      pen.line(0, 2.4, arc(48, 22, 10, 9, 0, 2 * Math.PI, 24), { closed: true, wobble: 0.3 });
      pen.line(0, 2.4, arc(48, 50, 10, 9, 0, 2 * Math.PI, 24), { closed: true, wobble: 0.3 });
      pen.line(0, 2.4, [[57, 26], [80, 36], [118, 14], [84, 38]], { closed: true, wobble: 0.3 });
      pen.line(0, 2.4, [[57, 46], [80, 36], [118, 58], [84, 34]], { closed: true, wobble: 0.3 });
      pen.dot(2, 5, 80, 36);
      sparkle(pen, 140, 30, 8);
    }
  },
  crate: {
    size: ICON,
    paint(pen) {
      pen.line(2, 2.6, roundRect(6, 28, 58, 58, 6), { closed: true });
      pen.line(2, 2, [[8, 30], [62, 84]], { wobble: 0.3 });
      pen.line(2, 2, [[62, 30], [8, 84]], { wobble: 0.3 });
      pen.line(0, 2.4, [[64, 50], [112, 50]], { wobble: 0.3 });
      pen.line(0, 2.4, [[64, 64], [112, 64]], { wobble: 0.3 });
      pen.line(0, 2.2, [[112, 46], [112, 68]], { wobble: 0.2 });
      [[120, 50], [134, 62], [148, 50]].forEach(([x, y]) => pen.line(3, 2.2, roundRect(x, y, 10, 10, 2), { closed: true, wobble: 0.2 }));
      dashed(pen, 3, [[118, 82], [156, 82]], 6, 5);
      sparkle(pen, 100, 22, 8);
    }
  },
  press: {
    size: ICON,
    paint(pen) {
      pen.line(0, 2.6, roundRect(36, 16, 88, 12, 3), { closed: true, wobble: 0.3 });
      pen.line(0, 2.4, [[80, 16], [80, 2]], { wobble: 0.2 });
      pen.line(0, 2.4, [[64, 2], [96, 2]], { wobble: 0.2 });
      pen.line(0, 2.6, roundRect(36, 102, 88, 12, 3), { closed: true, wobble: 0.3 });
      pen.line(5, 2.4, roundRect(46, 72, 68, 30, 5), { closed: true });
      pen.line(5, 1.8, wave(54, 106, 87, 2.4, 13), { wobble: 0.2 });
      arrow(pen, 2, [22, 34], [22, 70]);
      arrow(pen, 2, [138, 34], [138, 70]);
      sparkle(pen, 150, 14, 7);
    }
  }
};
