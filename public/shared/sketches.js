import { arc, astroid, bezier, heart, roundRect, spline, wave } from './ink.js';

const HERO = [520, 320];

function arrowHead(pen, color, width, tip, from, size = 9) {
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  pen.line(color, width, [
    [tip[0] - size * Math.cos(angle - 0.5), tip[1] - size * Math.sin(angle - 0.5)],
    tip,
    [tip[0] - size * Math.cos(angle + 0.5), tip[1] - size * Math.sin(angle + 0.5)]
  ], { wobble: 0.3 });
}

function envelope(pen, color, x, y, w, h) {
  pen.line(color, 2.4, roundRect(x, y, w, h, Math.min(6, h / 5)), { closed: true });
  pen.line(color, 2, [[x + 3, y + 3], [x + w / 2, y + h * 0.58], [x + w - 3, y + 3]], { wobble: 0.6 });
}

function sparkles(pen, points) {
  pen.part('sparkle');
  for (const [x, y, r] of points) pen.line(7, 2.2, astroid(x, y, r), { closed: true, wobble: 0.3, step: 2, quick: true });
}

function digit(pen, color, value, x, y, size = 14) {
  const s = size / 14;
  const shapes = {
    1: [[[x - 4 * s, y - 8 * s], [x + 1 * s, y - 13 * s], [x + 1 * s, y + 13 * s]]],
    2: [spline([[x - 6 * s, y - 7 * s], [x - 1 * s, y - 13 * s], [x + 6 * s, y - 9 * s], [x + 5 * s, y - 1 * s], [x - 6 * s, y + 12 * s], [x + 7 * s, y + 12 * s]], false, 6)],
    3: [spline([[x - 6 * s, y - 10 * s], [x + 3 * s, y - 13 * s], [x + 6 * s, y - 6 * s], [x, y - 1 * s], [x + 7 * s, y + 5 * s], [x + 3 * s, y + 12 * s], [x - 7 * s, y + 10 * s]], false, 6)]
  };
  for (const shape of shapes[value]) pen.line(color, 2.2, shape, { wobble: 0.3, step: 2 });
}

function phone(pen, x, y, w, h) {
  pen.line(0, 2.4, roundRect(x, y, w, h, 14), { closed: true });
  pen.line(0, 2, [[x + w * 0.38, y + 10], [x + w * 0.62, y + 10]], { wobble: 0.2 });
}

function bubble(pen, color, x, y, w, h, side) {
  pen.line(color, 2.2, roundRect(x, y, w, h, Math.min(12, h / 3)), { closed: true });
  const tail = side === 'left'
    ? [[x + 12, y + h - 1], [x + 3, y + h + 11], [x + 22, y + h - 1]]
    : [[x + w - 12, y + h - 1], [x + w - 3, y + h + 11], [x + w - 22, y + h - 1]];
  pen.line(color, 2.2, spline(tail, false, 6), { wobble: 0.3 });
}

function dashed(pen, color, points, dash = 11, gap = 8) {
  let segment = [points[0]];
  let run = 0;
  let drawing = true;
  for (let i = 1; i < points.length; i++) {
    run += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    if (drawing) segment.push(points[i]);
    if (drawing && run >= dash) {
      pen.line(color, 1.8, segment, { wobble: 0.2, step: 2, quick: true });
      drawing = false;
      run = 0;
    } else if (!drawing && run >= gap) {
      drawing = true;
      run = 0;
      segment = [points[i]];
    }
  }
  if (drawing && segment.length > 1) pen.line(color, 1.8, segment, { wobble: 0.2, step: 2, quick: true });
}

function loopTrail(pen, color, start, center, radius, end) {
  const bottom = [center[0], center[1] + radius];
  dashed(pen, color, [
    ...bezier(start, [start[0] + (bottom[0] - start[0]) * 0.4, start[1]], [bottom[0] - radius, bottom[1]], bottom, 40),
    ...arc(center[0], center[1], radius, radius, Math.PI / 2, -1.5 * Math.PI, 96),
    ...bezier(bottom, [bottom[0] + radius * 1.2, bottom[1]], [end[0] - radius, end[1] + 10], end, 40)
  ]);
}

function feather(pen, color, base, tip, width = 12) {
  const spine = bezier(base, [base[0] + (tip[0] - base[0]) * 0.25 + 6, base[1] + (tip[1] - base[1]) * 0.3], [base[0] + (tip[0] - base[0]) * 0.7 + 4, base[1] + (tip[1] - base[1]) * 0.75], tip, 30);
  pen.line(0, 2, spine, { wobble: 0.2 });
  for (let i = 8; i < spine.length - 1; i += 3) {
    const [x, y] = spine[i];
    const [nx, ny] = spine[i + 1];
    const length = Math.hypot(nx - x, ny - y) || 1;
    const side = [-(ny - y) / length, (nx - x) / length];
    const along = [(nx - x) / length, (ny - y) / length];
    const size = width * Math.sin(Math.PI * (i - 6) / (spine.length - 4));
    for (const sign of [1, -1]) {
      pen.line(color, 1.8, [[x, y], [x + side[0] * size * sign - along[0] * 5, y + side[1] * size * sign - along[1] * 5]], { wobble: 0.1, quick: true });
    }
  }
}

function house(pen, x, y, color) {
  pen.line(0, 2.4, [[x, y + 26], [x, y + 86], [x + 84, y + 86], [x + 84, y + 26]], { wobble: 0.5 });
  pen.line(color, 2.6, [[x - 10, y + 30], [x + 42, y - 8], [x + 94, y + 30]], { wobble: 0.5 });
  pen.line(0, 2.2, [[x + 64, y + 8], [x + 64, y - 6], [x + 76, y - 6], [x + 76, y + 17]], { wobble: 0.3 });
  pen.line(0, 2.2, roundRect(x + 32, y + 52, 20, 34, 4), { closed: true, wobble: 0.3 });
  pen.line(1, 2, roundRect(x + 10, y + 40, 16, 16, 3), { closed: true, wobble: 0.3 });
}

export const SKETCHES = {
  'messenger-hero': {
    size: HERO,
    jitter: 1.2,
    paint(pen) {
      pen.part('phone');
      phone(pen, 26, 70, 96, 188);
      bubble(pen, 1, 38, 100, 66, 30, 'left');
      pen.line(1, 1.8, wave(46, 92, 112, 1.6, 18), { wobble: 0.2 });
      bubble(pen, 3, 52, 148, 60, 30, 'right');
      [68, 82, 96].forEach(x => pen.dot(3, 4.6, x, 163));
      bubble(pen, 1, 38, 196, 50, 28, 'left');
      pen.line(1, 1.8, wave(46, 80, 210, 1.4, 16), { wobble: 0.2 });
      pen.part('trail');
      loopTrail(pen, 5, [132, 170], [226, 104], 34, [342, 118]);
      pen.part('plane');
      pen.line(5, 2.4, [[482, 62], [346, 112], [382, 130], [482, 62]], { closed: true, wobble: 0.5 });
      pen.line(5, 2.4, [[382, 130], [366, 164], [482, 62]], { wobble: 0.5 });
      pen.line(5, 1.8, [[382, 130], [430, 92]], { wobble: 0.3 });
      pen.part('wiggle');
      bubble(pen, 2, 404, 196, 92, 50, 'right');
      pen.line(2, 2.4, [[426, 206], [426, 236]], { wobble: 0.2 });
      pen.line(2, 2.4, spline([[426, 222], [433, 215], [442, 216], [444, 224], [444, 236]], false, 6), { wobble: 0.2 });
      pen.line(2, 2.4, [[458, 220], [458, 236]], { wobble: 0.2 });
      pen.dot(2, 4.6, 458, 210);
      pen.line(2, 2.4, [[472, 206], [471, 228]], { wobble: 0.2 });
      pen.dot(2, 4.6, 471, 237);
      pen.part('beat');
      pen.line(4, 2.2, heart(186, 44, 22), { closed: true, wobble: 0.3, step: 2 });
      sparkles(pen, [[300, 40, 11], [500, 150, 9], [322, 230, 7]]);
    }
  },
  server: {
    size: [160, 120],
    paint(pen) {
      pen.part('rack');
      pen.line(0, 2.4, roundRect(50, 22, 60, 90, 8), { closed: true });
      pen.line(0, 2, [[50, 52], [110, 52]], { wobble: 0.3 });
      pen.line(0, 2, [[50, 82], [110, 82]], { wobble: 0.3 });
      [37, 67, 97].forEach(y => pen.line(0, 1.8, [[78, y], [100, y]], { wobble: 0.2 }));
      pen.part('blink');
      [37, 67, 97].forEach(y => pen.dot(3, 5.5, 62, y));
      pen.part('pulse');
      [14, 24, 34].forEach(radius => pen.line(1, 2.2, arc(80, 14, radius, radius * 0.7, Math.PI * 1.15, Math.PI * 1.85, 16), { wobble: 0.3 }));
      pen.part('cable');
      pen.line(2, 2.2, spline([[50, 96], [30, 100], [22, 114]], false, 6), { wobble: 0.3 });
      pen.line(5, 2.2, spline([[110, 96], [130, 100], [138, 114]], false, 6), { wobble: 0.3 });
      sparkles(pen, [[140, 30, 8]]);
    }
  },
  contract: {
    size: [170, 120],
    paint(pen) {
      pen.part('paper');
      pen.line(0, 2.4, [[30, 8], [92, 8], [110, 26], [110, 110], [30, 110], [30, 8]], { closed: true, wobble: 0.6 });
      pen.line(0, 2, [[92, 8], [92, 26], [110, 26]], { wobble: 0.3 });
      [[42, 40, 86], [42, 54, 96], [42, 68, 76]].forEach(([x, y, end]) => pen.line(0, 1.8, wave(x, end, y, 1.2, 16), { wobble: 0.2 }));
      pen.part('stamp');
      pen.line(6, 2.2, arc(84, 90, 13, 13, -Math.PI / 2, 1.5 * Math.PI, 24), { closed: true, wobble: 0.3 });
      pen.line(6, 2.2, [[77, 90], [82, 95], [91, 84]], { wobble: 0.2 });
      pen.line(6, 2.2, [[78, 102], [73, 116]], { wobble: 0.2 });
      pen.line(6, 2.2, [[90, 102], [95, 116]], { wobble: 0.2 });
      pen.part('write');
      feather(pen, 5, [120, 104], [162, 18], 11);
      pen.line(0, 2.2, [[120, 104], [116, 112]], { wobble: 0.1 });
      sparkles(pen, [[14, 24, 8]]);
    }
  },
  padlock: {
    size: [180, 120],
    paint(pen) {
      pen.part('shackle');
      pen.line(0, 2.6, spline([[72, 56], [72, 34], [90, 20], [108, 34], [108, 56]], false, 8), { wobble: 0.4 });
      pen.part('body');
      pen.line(7, 2.6, roundRect(56, 54, 68, 54, 10), { closed: true });
      pen.line(0, 2.2, arc(90, 76, 5, 5, -Math.PI / 2, 1.5 * Math.PI, 12), { closed: true, wobble: 0.1, step: 1.5 });
      pen.line(0, 2.2, [[90, 81], [90, 94]], { wobble: 0.1 });
      pen.part('nudge-left');
      pen.line(1, 2.4, [[8, 100], [44, 90]], { wobble: 0.3 });
      arrowHead(pen, 1, 2.4, [44, 90], [8, 100]);
      pen.part('nudge-right');
      pen.line(2, 2.4, [[172, 100], [136, 90]], { wobble: 0.3 });
      arrowHead(pen, 2, 2.4, [136, 90], [172, 100]);
      sparkles(pen, [[146, 24, 8], [28, 30, 6]]);
    }
  },
  antenna: {
    size: [150, 120],
    paint(pen) {
      pen.part('tower');
      pen.line(0, 2.4, [[75, 34], [55, 112]], { wobble: 0.4 });
      pen.line(0, 2.4, [[75, 34], [95, 112]], { wobble: 0.4 });
      pen.line(0, 2, [[67, 64], [83, 64]], { wobble: 0.2 });
      pen.line(0, 2, [[61, 88], [89, 88]], { wobble: 0.2 });
      pen.line(0, 2, [[67, 64], [89, 88]], { wobble: 0.2 });
      pen.line(0, 2.4, [[43, 112], [107, 112]], { wobble: 0.3 });
      pen.part('blink');
      pen.dot(6, 8, 75, 30);
      pen.part('pulse');
      [16, 28, 40].forEach((radius, index) => {
        pen.line(1, 2.2, arc(75, 30, radius, radius, Math.PI * 0.74, Math.PI * 1.26, 16), { wobble: 0.3 });
        pen.line(index === 1 ? 2 : 1, 2.2, arc(75, 30, radius, radius, -Math.PI * 0.26, Math.PI * 0.26, 16), { wobble: 0.3 });
      });
    }
  },
  mailbox: {
    size: [190, 120],
    paint(pen) {
      pen.part('box');
      pen.line(0, 2.6, [[118, 112], [118, 70]], { wobble: 0.3 });
      pen.line(1, 2.4, [[84, 72], [84, 40], ...arc(110, 40, 26, 26, Math.PI, 2 * Math.PI, 20), [136, 72], [84, 72]], { closed: true });
      pen.line(1, 2, arc(136, 56, 9, 16, -Math.PI / 2, Math.PI / 2, 12), { wobble: 0.3 });
      pen.part('flag');
      pen.line(6, 2.2, [[144, 64], [144, 28], [162, 28], [162, 40], [144, 40]], { wobble: 0.3 });
      pen.part('drop');
      envelope(pen, 2, 20, 14, 34, 24);
      pen.line(0, 1.6, [[22, 46], [40, 46]], { wobble: 0.2, quick: true });
      pen.line(0, 1.6, [[12, 54], [32, 54]], { wobble: 0.2, quick: true });
      pen.part('ground');
      pen.line(3, 2.2, wave(60, 184, 113, 1.6, 26), { wobble: 0.3 });
      sparkles(pen, [[176, 16, 7], [62, 16, 5]]);
    }
  },
  plug: {
    size: [200, 110],
    paint(pen) {
      pen.part('plug');
      pen.line(0, 2.4, spline([[4, 88], [30, 76], [52, 84], [64, 72]], false, 8), { wobble: 0.4 });
      pen.line(1, 2.4, roundRect(62, 58, 26, 26, 6), { closed: true });
      pen.line(1, 2.2, [[88, 65], [100, 65]], { wobble: 0.1 });
      pen.line(1, 2.2, [[88, 77], [100, 77]], { wobble: 0.1 });
      pen.part('socket');
      pen.line(2, 2.4, roundRect(128, 54, 26, 34, 7), { closed: true });
      pen.dot(2, 4.6, 134, 65);
      pen.dot(2, 4.6, 134, 77);
      pen.line(0, 2.4, spline([[154, 72], [168, 68], [176, 86], [196, 92]], false, 8), { wobble: 0.4 });
      pen.part('flash');
      pen.line(7, 2.6, [[117, 50], [110, 64], [120, 68], [112, 84]], { wobble: 0.2 });
      pen.line(7, 1.8, [[124, 50], [130, 44]], { wobble: 0.1, quick: true });
      pen.line(7, 1.8, [[104, 90], [98, 96]], { wobble: 0.1, quick: true });
      pen.part('spin');
      pen.line(3, 2.4, arc(114, 22, 15, 15, Math.PI * 0.95, Math.PI * 2.6, 32), { wobble: 0.3 });
      arrowHead(pen, 3, 2.4, arc(114, 22, 15, 15, Math.PI * 2.6, Math.PI * 2.6, 1)[0], arc(114, 22, 15, 15, Math.PI * 2.4, Math.PI * 2.4, 1)[0], 7);
    }
  },
  trophy: {
    size: [170, 120],
    paint(pen) {
      pen.part('cup');
      pen.line(7, 2.6, [[49, 18], [121, 18]], { wobble: 0.4 });
      pen.line(7, 2.6, spline([[51, 18], [53, 46], [67, 64], [85, 69], [103, 64], [117, 46], [119, 18]], false, 8));
      pen.line(7, 2.4, spline([[51, 26], [33, 26], [33, 44], [55, 52]], false, 8), { wobble: 0.5 });
      pen.line(7, 2.4, spline([[119, 26], [137, 26], [137, 44], [115, 52]], false, 8), { wobble: 0.5 });
      pen.line(7, 2.6, [[85, 70], [85, 88]], { wobble: 0.3 });
      pen.line(0, 2.4, roundRect(63, 88, 44, 14, 4), { closed: true });
      pen.line(0, 2.4, [[53, 108], [117, 108]], { wobble: 0.4 });
      pen.part('shine');
      pen.line(2, 2.2, astroid(85, 40, 10), { closed: true, wobble: 0.2, step: 2 });
      pen.part('confetti');
      [[16, 44, 4], [150, 60, 1], [28, 76, 3], [156, 88, 5], [20, 100, 6], [146, 104, 2]].forEach(([x, y, color]) => pen.line(color, 2.4, [[x, y], [x + 6, y - 5]], { wobble: 0.1, quick: true }));
      sparkles(pen, [[24, 18, 8], [150, 30, 9], [142, 86, 6]]);
    }
  },
  pencil: {
    size: [160, 120],
    paint(pen) {
      pen.part('wiggle');
      const a = [124, 16];
      const b = [52, 88];
      const tip = [38, 102];
      const n = [0.707, 0.707];
      const side = (point, sign) => [point[0] + n[0] * 9 * sign, point[1] + n[1] * 9 * sign];
      pen.line(7, 2.4, [side(a, 1), side(b, 1)], { wobble: 0.4 });
      pen.line(7, 2.4, [side(a, -1), side(b, -1)], { wobble: 0.4 });
      pen.line(0, 2.4, [side(b, 1), tip, side(b, -1)], { wobble: 0.3 });
      pen.dot(0, 5, tip[0] + 2, tip[1] - 2);
      pen.line(4, 2.4, [side(a, 1), side([a[0] + 9, a[1] - 9], 1), side([a[0] + 9, a[1] - 9], -1), side(a, -1)], { wobble: 0.3 });
      pen.part('scribble');
      pen.line(1, 2, spline([[36, 106], [18, 98], [12, 110], [26, 116], [52, 110], [74, 116], [96, 108]], false, 8), { wobble: 0.5 });
      sparkles(pen, [[140, 60, 7]]);
    }
  },
  'postal-hero': {
    size: HERO,
    jitter: 1.2,
    paint(pen) {
      pen.part('houses');
      house(pen, 22, 176, 6);
      house(pen, 412, 176, 1);
      pen.part('trail');
      dashed(pen, 5, bezier([108, 250], [200, 318], [330, 318], [424, 250], 80));
      pen.part('float');
      pen.line(0, 2.6, roundRect(160, 36, 196, 124, 10), { closed: true });
      pen.line(0, 2.2, [[164, 40], [258, 106], [352, 40]], { wobble: 0.6 });
      for (let x = 176; x < 344; x += 18) {
        const color = Math.round((x - 176) / 18) % 2 ? 1 : 6;
        pen.line(color, 3, [[x, 48], [x + 9, 42]], { wobble: 0.1, quick: true });
        pen.line(color, 3, [[x, 154], [x + 9, 148]], { wobble: 0.1, quick: true });
      }
      pen.part('stamp');
      const stamp = [];
      const [sx, sy, sw, sh] = [294, 64, 42, 50];
      for (let i = 0; i <= 8; i++) stamp.push([sx + sw * i / 8, sy + (i % 2 ? -3 : 0)]);
      for (let i = 1; i <= 10; i++) stamp.push([sx + sw + (i % 2 ? 3 : 0), sy + sh * i / 10]);
      for (let i = 1; i <= 8; i++) stamp.push([sx + sw - sw * i / 8, sy + sh + (i % 2 ? 3 : 0)]);
      for (let i = 1; i <= 10; i++) stamp.push([sx + (i % 2 ? -3 : 0), sy + sh - sh * i / 10]);
      pen.line(3, 2.2, stamp, { closed: true, wobble: 0.2, step: 2 });
      pen.line(4, 2.2, heart(315, 90, 22), { closed: true, wobble: 0.2, step: 2 });
      pen.part('postmark');
      pen.line(0, 1.8, arc(284, 88, 26, 26, -Math.PI / 2, 1.5 * Math.PI, 40), { closed: true, wobble: 0.3 });
      pen.line(0, 1.6, arc(284, 88, 19, 19, -Math.PI / 2, 1.5 * Math.PI, 32), { closed: true, wobble: 0.3 });
      [78, 88, 98].forEach(y => pen.line(0, 1.6, wave(196, 256, y, 3, 20), { wobble: 0.2, quick: true }));
      sparkles(pen, [[120, 60, 11], [470, 90, 10], [396, 30, 7], [52, 130, 6]]);
    }
  },
  storm: {
    size: [170, 120],
    paint(pen) {
      pen.part('float');
      pen.line(1, 2.4, spline([[28, 56], [24, 40], [40, 30], [54, 34], [62, 16], [86, 12], [100, 28], [118, 24], [134, 38], [130, 56]], false, 8), { wobble: 0.5 });
      pen.line(1, 2.4, [[28, 56], [130, 56]], { wobble: 0.4 });
      pen.part('flash');
      pen.line(7, 2.6, [[80, 60], [70, 80], [84, 82], [72, 104]], { wobble: 0.2 });
      pen.part('wiggle');
      envelope(pen, 0, 112, 78, 36, 24);
      pen.line(0, 1.6, [[118, 66], [124, 60]], { wobble: 0.1, quick: true });
      pen.line(0, 1.6, [[134, 68], [140, 62]], { wobble: 0.1, quick: true });
      pen.part('fall');
      envelope(pen, 6, 18, 80, 30, 20);
      pen.line(6, 2.2, [[16, 108], [50, 76]], { wobble: 0.2 });
      sparkles(pen, [[156, 20, 6]]);
    }
  },
  once: {
    size: [190, 110],
    paint(pen) {
      pen.part('fly');
      envelope(pen, 0, 16, 40, 58, 40);
      pen.part('path');
      pen.line(5, 1.8, [[84, 58], [104, 52], [124, 44], [146, 34]], { wobble: 0.3 });
      arrowHead(pen, 5, 2, [158, 28], [146, 34]);
      pen.part('never');
      pen.line(2, 2.4, arc(146, 82, 13, 13, Math.PI * 0.2, Math.PI * 1.8, 24), { wobble: 0.3 });
      arrowHead(pen, 2, 2.2, arc(146, 82, 13, 13, Math.PI * 1.8, Math.PI * 1.8, 1)[0], arc(146, 82, 13, 13, Math.PI * 1.6, Math.PI * 1.6, 1)[0], 7);
      pen.line(6, 2.6, [[126, 64], [166, 100]], { wobble: 0.3 });
      digit(pen, 2, 1, 46, 98, 13);
      sparkles(pen, [[176, 14, 7]]);
    }
  },
  retry: {
    size: [150, 120],
    paint(pen) {
      pen.part('float');
      envelope(pen, 0, 49, 42, 52, 36);
      pen.part('spin');
      pen.line(3, 2.6, arc(75, 60, 50, 44, -Math.PI * 0.35, Math.PI * 1.25, 56), { wobble: 0.5 });
      arrowHead(pen, 3, 2.6, arc(75, 60, 50, 44, Math.PI * 1.25, Math.PI * 1.25, 1)[0], arc(75, 60, 50, 44, Math.PI * 1.12, Math.PI * 1.12, 1)[0], 10);
      pen.part('wiggle');
      envelope(pen, 1, 112, 90, 30, 20);
      pen.line(1, 1.6, [[98, 94], [106, 94]], { wobble: 0.1, quick: true });
      sparkles(pen, [[20, 16, 7]]);
    }
  },
  stamp: {
    size: [180, 120],
    paint(pen) {
      pen.part('letter');
      envelope(pen, 0, 26, 52, 116, 62);
      pen.part('postmark');
      pen.line(3, 2.4, arc(84, 88, 20, 20, -Math.PI / 2, 1.5 * Math.PI, 32), { closed: true, wobble: 0.4 });
      digit(pen, 3, 1, 84, 88, 12);
      pen.part('press');
      pen.line(2, 2.6, arc(84, 10, 10, 8, -Math.PI / 2, 1.5 * Math.PI, 20), { closed: true, wobble: 0.3 });
      pen.line(2, 2.4, [[80, 18], [78, 32]], { wobble: 0.2 });
      pen.line(2, 2.4, [[88, 18], [90, 32]], { wobble: 0.2 });
      pen.line(0, 2.4, roundRect(62, 32, 44, 14, 4), { closed: true, wobble: 0.3 });
      pen.line(3, 2.2, [[64, 50], [104, 50]], { wobble: 0.2 });
      sparkles(pen, [[150, 84, 7], [148, 24, 6]]);
    }
  },
  ordered: {
    size: [220, 110],
    paint(pen) {
      [[18, 1, 'hop-a'], [90, 2, 'hop-b'], [162, 3, 'hop-c']].forEach(([x, value, part], index) => {
        pen.part(part);
        envelope(pen, [1, 5, 3][index], x, 46, 40, 28);
        digit(pen, [1, 5, 3][index], value, x + 20, 94, 12);
      });
      pen.part('links');
      pen.line(0, 1.8, [[62, 60], [84, 60]], { wobble: 0.1 });
      arrowHead(pen, 0, 1.8, [86, 60], [62, 60], 6);
      pen.line(0, 1.8, [[134, 60], [156, 60]], { wobble: 0.1 });
      arrowHead(pen, 0, 1.8, [158, 60], [134, 60], 6);
      pen.part('trail');
      dashed(pen, 3, bezier([30, 26], [80, 8], [140, 34], [196, 16], 40), 9, 6);
      sparkles(pen, [[208, 36, 6]]);
    }
  },
  gauge: {
    size: [170, 110],
    paint(pen) {
      pen.part('dial');
      pen.line(0, 2.6, arc(85, 92, 58, 58, Math.PI, 2 * Math.PI, 40), { wobble: 0.5 });
      pen.line(0, 2.4, [[27, 92], [143, 92]], { wobble: 0.3 });
      Array.from({ length: 7 }, (_, index) => Math.PI + Math.PI * index / 6).forEach((angle, index) => {
        pen.line(index > 4 ? 6 : 3, 2.2, [[85 + 50 * Math.cos(angle), 92 + 50 * Math.sin(angle)], [85 + 42 * Math.cos(angle), 92 + 42 * Math.sin(angle)]], { wobble: 0.1, quick: true });
      });
      pen.part('swing');
      pen.line(2, 2.6, [[85, 92], [63, 58]], { wobble: 0.2 });
      pen.part('pivot');
      pen.dot(0, 9, 85, 92);
      sparkles(pen, [[154, 24, 8]]);
    }
  },
  bug: {
    size: [150, 120],
    paint(pen) {
      pen.part('legs');
      [[36, 50], [30, 72], [38, 96]].forEach(([x, y], index) => {
        pen.line(0, 2.2, [[50, 56 + index * 16], [x, y]], { wobble: 0.2 });
        pen.line(0, 2.2, [[100, 56 + index * 16], [150 - x, y]], { wobble: 0.2 });
      });
      pen.part('body');
      pen.line(6, 2.6, arc(75, 70, 28, 36, -Math.PI / 2, 1.5 * Math.PI, 40), { closed: true });
      pen.line(0, 2.4, arc(75, 26, 14, 12, -Math.PI / 2, 1.5 * Math.PI, 24), { closed: true, wobble: 0.3 });
      pen.line(0, 2, [[75, 36], [75, 104]], { wobble: 0.3 });
      [[65, 58], [87, 72], [63, 84]].forEach(([x, y]) => pen.dot(0, 7, x, y));
      pen.part('antenna');
      pen.line(0, 2, spline([[69, 16], [61, 6], [51, 6]], false, 6), { wobble: 0.2 });
      pen.line(0, 2, spline([[81, 16], [89, 6], [99, 6]], false, 6), { wobble: 0.2 });
      sparkles(pen, [[126, 22, 7]]);
    }
  },
  rosette: {
    size: [150, 120],
    paint(pen) {
      pen.part('ribbons');
      pen.line(1, 2.4, [[62, 74], [50, 116], [60, 110], [66, 118], [74, 80]], { wobble: 0.3 });
      pen.line(6, 2.4, [[88, 74], [100, 116], [90, 110], [84, 118], [76, 80]], { wobble: 0.3 });
      pen.part('shine');
      pen.line(7, 2.6, Array.from({ length: 97 }, (_, index) => {
        const angle = Math.PI * 2 * index / 96;
        const radius = 34 + 4 * Math.sin(angle * 12);
        return [75 + radius * Math.cos(angle), 52 + radius * Math.sin(angle)];
      }), { closed: true, wobble: 0.2, step: 2 });
      pen.part('medal');
      pen.line(2, 2.4, arc(75, 52, 22, 22, -Math.PI / 2, 1.5 * Math.PI, 36), { closed: true, wobble: 0.3 });
      pen.line(3, 2.8, [[65, 52], [72, 60], [86, 43]], { wobble: 0.2 });
      sparkles(pen, [[20, 22, 8], [132, 20, 7], [130, 96, 6]]);
    }
  },
  quill: {
    size: [160, 120],
    paint(pen) {
      pen.part('pot');
      pen.line(0, 2.4, spline([[52, 78], [44, 90], [46, 110], [80, 112], [104, 110], [106, 90], [98, 78]], false, 8), { wobble: 0.4 });
      pen.line(0, 2.4, arc(75, 78, 24, 6, 0, Math.PI * 2, 24), { closed: true, wobble: 0.2 });
      pen.line(1, 2.2, wave(54, 96, 98, 1.5, 14), { wobble: 0.2 });
      pen.part('write');
      feather(pen, 5, [80, 80], [138, 8], 13);
      pen.part('scribble');
      pen.line(1, 2, spline([[10, 104], [18, 94], [26, 108], [34, 96], [40, 104]], false, 6), { wobble: 0.3 });
      sparkles(pen, [[24, 30, 8], [144, 60, 6]]);
    }
  }
};
