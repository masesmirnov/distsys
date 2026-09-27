import { arc, astroid, bezier, heart, roundRect, spline, wave } from './ink.js';

const ICON = [160, 120];
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

function sparkle(pen, x, y, r) {
  pen.line(7, 2.2, astroid(x, y, r), { closed: true, wobble: 0.3, step: 2 });
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

function loopTrail(pen, color, start, center, radius, end) {
  const bottom = [center[0], center[1] + radius];
  dashed(pen, color, [
    ...bezier(start, [start[0] + (bottom[0] - start[0]) * 0.4, start[1]], [bottom[0] - radius, bottom[1]], bottom, 40),
    ...arc(center[0], center[1], radius, radius, Math.PI / 2, -1.5 * Math.PI, 96),
    ...bezier(bottom, [bottom[0] + radius * 1.2, bottom[1]], [end[0] - radius, end[1] + 10], end, 40)
  ]);
}

function paperPlane(pen, color, tip, back, fold, keel) {
  pen.line(color, 2.4, [tip, back, fold, tip], { closed: true, wobble: 0.5 });
  pen.line(color, 2.4, [fold, keel, tip], { wobble: 0.5 });
}

function mailbox(pen, x, y, scale = 1) {
  const s = scale;
  pen.line(0, 2.6, [[x + 34 * s, y + 108 * s], [x + 34 * s, y + 66 * s]], { wobble: 0.3 });
  pen.line(1, 2.4, [[x, y + 68 * s], [x, y + 36 * s], ...arc(x + 26 * s, y + 36 * s, 26 * s, 26 * s, Math.PI, 2 * Math.PI, 20), [x + 52 * s, y + 68 * s], [x, y + 68 * s]], { closed: true });
  pen.line(1, 2, arc(x + 52 * s, y + 52 * s, 9 * s, 16 * s, -Math.PI / 2, Math.PI / 2, 12), { wobble: 0.3 });
  pen.line(6, 2.2, [[x + 60 * s, y + 60 * s], [x + 60 * s, y + 24 * s], [x + 78 * s, y + 24 * s], [x + 78 * s, y + 36 * s], [x + 60 * s, y + 36 * s]], { wobble: 0.3 });
}

function trophy(pen) {
  pen.line(7, 2.6, [[44, 18], [116, 18]], { wobble: 0.4 });
  pen.line(7, 2.6, spline([[46, 18], [48, 46], [62, 64], [80, 69], [98, 64], [112, 46], [114, 18]], false, 8));
  pen.line(7, 2.4, spline([[46, 26], [28, 26], [28, 44], [50, 52]], false, 8), { wobble: 0.5 });
  pen.line(7, 2.4, spline([[114, 26], [132, 26], [132, 44], [110, 52]], false, 8), { wobble: 0.5 });
  pen.line(7, 2.6, [[80, 70], [80, 88]], { wobble: 0.3 });
  pen.line(0, 2.4, roundRect(58, 88, 44, 14, 4), { closed: true });
  pen.line(0, 2.4, [[48, 108], [112, 108]], { wobble: 0.4 });
  pen.line(2, 2.2, astroid(80, 40, 10), { closed: true, wobble: 0.2, step: 2 });
  sparkle(pen, 20, 18, 8);
  sparkle(pen, 146, 30, 9);
  sparkle(pen, 138, 94, 6);
}

function pencil(pen) {
  const a = [124, 16];
  const b = [52, 88];
  const tip = [38, 102];
  const n = [0.707, 0.707];
  const w = 9;
  const side = (point, sign) => [point[0] + n[0] * w * sign, point[1] + n[1] * w * sign];
  pen.line(7, 2.4, [side(a, 1), side(b, 1)], { wobble: 0.4 });
  pen.line(7, 2.4, [side(a, -1), side(b, -1)], { wobble: 0.4 });
  pen.line(0, 2.4, [side(b, 1), tip, side(b, -1)], { wobble: 0.3 });
  pen.dot(0, 5, tip[0] + 2, tip[1] - 2);
  pen.line(4, 2.4, [side(a, 1), side([a[0] + 9, a[1] - 9], 1), side([a[0] + 9, a[1] - 9], -1), side(a, -1)], { wobble: 0.3 });
  pen.line(1, 2, spline([[36, 106], [18, 98], [12, 110], [26, 116], [52, 110], [74, 116], [96, 108]], false, 8), { wobble: 0.5 });
}

export const SKETCHES = {
  'messenger-hero': {
    size: HERO,
    jitter: 1.2,
    paint(pen) {
      phone(pen, 26, 70, 96, 188);
      bubble(pen, 1, 38, 100, 66, 30, 'left');
      pen.line(1, 1.8, wave(46, 92, 112, 1.6, 18), { wobble: 0.2 });
      bubble(pen, 3, 52, 148, 60, 30, 'right');
      [68, 82, 96].forEach(x => pen.dot(3, 4.6, x, 163));
      bubble(pen, 1, 38, 196, 50, 28, 'left');
      pen.line(1, 1.8, wave(46, 80, 210, 1.4, 16), { wobble: 0.2 });
      loopTrail(pen, 5, [132, 170], [226, 104], 34, [342, 118]);
      paperPlane(pen, 5, [482, 62], [346, 112], [382, 130], [366, 164]);
      pen.line(5, 1.8, [[382, 130], [430, 92]], { wobble: 0.3 });
      bubble(pen, 2, 404, 196, 92, 50, 'right');
      pen.line(2, 2.4, [[426, 206], [426, 236]], { wobble: 0.2 });
      pen.line(2, 2.4, spline([[426, 222], [433, 215], [442, 216], [444, 224], [444, 236]], false, 6), { wobble: 0.2 });
      pen.line(2, 2.4, [[458, 220], [458, 236]], { wobble: 0.2 });
      pen.dot(2, 4.6, 458, 210);
      pen.line(2, 2.4, [[472, 206], [471, 228]], { wobble: 0.2 });
      pen.dot(2, 4.6, 471, 237);
      pen.line(4, 2.2, heart(186, 44, 22), { closed: true, wobble: 0.3, step: 2 });
      sparkle(pen, 300, 40, 11);
      sparkle(pen, 500, 150, 9);
      sparkle(pen, 322, 230, 7);
    }
  },
  'airmail-hero': {
    size: HERO,
    jitter: 1.2,
    paint(pen) {
      mailbox(pen, 34, 132, 1.25);
      loopTrail(pen, 5, [150, 196], [236, 128], 36, [318, 118]);
      pen.line(1, 2.2, spline([[338, 128], [300, 96], [276, 104], [296, 118], [280, 130], [306, 142], [338, 144]], false, 8), { wobble: 0.4 });
      pen.line(1, 2.2, spline([[338, 116], [322, 84], [304, 82], [314, 100]], false, 8), { wobble: 0.4 });
      envelope(pen, 0, 336, 96, 124, 82);
      pen.line(6, 2.2, roundRect(430, 104, 20, 24, 3), { closed: true, wobble: 0.3 });
      pen.line(3, 2.6, [[378, 214], [392, 228], [420, 196]], { wobble: 0.4 });
      pen.line(4, 2.2, heart(470, 62, 22), { closed: true, wobble: 0.3, step: 2 });
      sparkle(pen, 206, 40, 11);
      sparkle(pen, 496, 172, 9);
      sparkle(pen, 300, 250, 7);
    }
  },
  server: {
    size: ICON,
    paint(pen) {
      pen.line(0, 2.4, roundRect(50, 22, 60, 90, 8), { closed: true });
      pen.line(0, 2, [[50, 52], [110, 52]], { wobble: 0.3 });
      pen.line(0, 2, [[50, 82], [110, 82]], { wobble: 0.3 });
      [37, 67, 97].forEach(y => {
        pen.dot(3, 5.5, 62, y);
        pen.line(0, 1.8, [[78, y], [100, y]], { wobble: 0.2 });
      });
      [14, 24].forEach(radius => pen.line(1, 2.2, arc(80, 12, radius, radius * 0.7, Math.PI * 1.15, Math.PI * 1.85, 16), { wobble: 0.3 }));
      pen.line(2, 2.2, spline([[50, 96], [30, 100], [22, 114]], false, 6), { wobble: 0.3 });
      pen.line(5, 2.2, spline([[110, 96], [130, 100], [138, 114]], false, 6), { wobble: 0.3 });
      sparkle(pen, 140, 30, 8);
    }
  },
  contract: {
    size: ICON,
    paint(pen) {
      pen.line(0, 2.4, [[42, 8], [106, 8], [124, 26], [124, 110], [42, 110], [42, 8]], { closed: true, wobble: 0.6 });
      pen.line(0, 2, [[106, 8], [106, 26], [124, 26]], { wobble: 0.3 });
      [[54, 40, 96], [54, 54, 108], [54, 68, 88]].forEach(([x, y, end]) => pen.line(0, 1.8, wave(x, end, y, 1.2, 16), { wobble: 0.2 }));
      pen.line(6, 2.2, arc(100, 90, 13, 13, -Math.PI / 2, 1.5 * Math.PI, 24), { closed: true, wobble: 0.3 });
      pen.line(6, 2.2, [[93, 90], [98, 95], [107, 84]], { wobble: 0.2 });
      pen.line(6, 2.2, [[94, 102], [89, 116]], { wobble: 0.2 });
      pen.line(6, 2.2, [[106, 102], [111, 116]], { wobble: 0.2 });
      sparkle(pen, 24, 24, 8);
    }
  },
  loop: {
    size: ICON,
    paint(pen) {
      pen.line(1, 2.6, arc(80, 62, 54, 40, -Math.PI * 0.3, Math.PI * 1.42, 64), { wobble: 0.5 });
      arrowHead(pen, 1, 2.6, arc(80, 62, 54, 40, Math.PI * 1.42, Math.PI * 1.42, 1)[0], arc(80, 62, 54, 40, Math.PI * 1.3, Math.PI * 1.3, 1)[0], 10);
      [[80, 22], [134, 62], [80, 102], [26, 62]].forEach(([x, y], index) => pen.line(index ? 0 : 2, index ? 2 : 2.6, roundRect(x - 11, y - 8, 22, 16, 4), { closed: true, wobble: 0.3 }));
      pen.line(2, 2.4, [[73, 52], [91, 62], [73, 72], [73, 52]], { closed: true, wobble: 0.3 });
      sparkle(pen, 146, 20, 8);
    }
  },
  antenna: {
    size: ICON,
    paint(pen) {
      pen.line(0, 2.4, [[80, 34], [60, 112]], { wobble: 0.4 });
      pen.line(0, 2.4, [[80, 34], [100, 112]], { wobble: 0.4 });
      pen.line(0, 2, [[72, 64], [88, 64]], { wobble: 0.2 });
      pen.line(0, 2, [[66, 88], [94, 88]], { wobble: 0.2 });
      pen.line(0, 2, [[72, 64], [94, 88]], { wobble: 0.2 });
      pen.line(0, 2.4, [[48, 112], [112, 112]], { wobble: 0.3 });
      pen.dot(6, 8, 80, 30);
      [16, 28, 40].forEach((radius, index) => {
        pen.line(1, 2.2, arc(80, 30, radius, radius, Math.PI * 0.74, Math.PI * 1.26, 16), { wobble: 0.3 });
        pen.line(index === 1 ? 2 : 1, 2.2, arc(80, 30, radius, radius, -Math.PI * 0.26, Math.PI * 0.26, 16), { wobble: 0.3 });
      });
    }
  },
  mailbox: {
    size: ICON,
    paint(pen) {
      mailbox(pen, 44, 4);
      envelope(pen, 2, 10, 22, 30, 20);
      pen.line(0, 1.6, [[14, 50], [30, 50]], { wobble: 0.2 });
      pen.line(0, 1.6, [[6, 58], [24, 58]], { wobble: 0.2 });
      pen.line(3, 2.2, wave(24, 140, 112, 1.6, 26), { wobble: 0.3 });
      sparkle(pen, 140, 20, 8);
    }
  },
  plug: {
    size: ICON,
    paint(pen) {
      pen.line(0, 2.4, spline([[4, 92], [26, 82], [44, 88], [52, 76]], false, 8), { wobble: 0.4 });
      pen.line(1, 2.4, roundRect(50, 62, 26, 26, 6), { closed: true });
      pen.line(1, 2.2, [[76, 69], [88, 69]], { wobble: 0.1 });
      pen.line(1, 2.2, [[76, 81], [88, 81]], { wobble: 0.1 });
      pen.line(2, 2.4, roundRect(108, 58, 26, 34, 7), { closed: true });
      pen.dot(2, 4.6, 114, 69);
      pen.dot(2, 4.6, 114, 81);
      pen.line(0, 2.4, spline([[134, 76], [146, 72], [150, 88], [158, 96]], false, 8), { wobble: 0.4 });
      pen.line(7, 2.4, [[99, 58], [94, 70], [102, 74], [96, 88]], { wobble: 0.2 });
      pen.line(3, 2.4, arc(97, 30, 18, 15, Math.PI * 0.95, Math.PI * 2.6, 32), { wobble: 0.3 });
      const end = arc(97, 30, 18, 15, Math.PI * 2.6, Math.PI * 2.6, 1)[0];
      const before = arc(97, 30, 18, 15, Math.PI * 2.45, Math.PI * 2.45, 1)[0];
      arrowHead(pen, 3, 2.4, end, before, 8);
    }
  },
  trophy: { size: ICON, paint: trophy },
  pencil: { size: ICON, paint: pencil },
  storm: {
    size: ICON,
    paint(pen) {
      pen.line(1, 2.4, spline([[28, 56], [24, 40], [40, 30], [54, 34], [62, 16], [86, 12], [100, 28], [118, 24], [134, 38], [130, 56]], false, 8), { wobble: 0.5 });
      pen.line(1, 2.4, [[28, 56], [130, 56]], { wobble: 0.4 });
      pen.line(7, 2.6, [[80, 60], [70, 80], [84, 82], [72, 104]], { wobble: 0.2 });
      envelope(pen, 0, 108, 78, 36, 24);
      pen.line(0, 1.6, [[114, 66], [120, 60]], { wobble: 0.1 });
      pen.line(0, 1.6, [[130, 68], [136, 62]], { wobble: 0.1 });
      envelope(pen, 6, 14, 84, 30, 20);
      pen.line(6, 2.2, [[12, 112], [46, 80]], { wobble: 0.2 });
    }
  },
  once: {
    size: ICON,
    paint(pen) {
      envelope(pen, 0, 16, 44, 56, 38);
      pen.line(5, 1.8, [[80, 62], [96, 58], [112, 52], [128, 44]], { wobble: 0.3 });
      arrowHead(pen, 5, 2, [140, 38], [128, 44]);
      pen.line(2, 2.4, arc(118, 94, 13, 13, Math.PI * 0.2, Math.PI * 1.8, 24), { wobble: 0.3 });
      arrowHead(pen, 2, 2.2, arc(118, 94, 13, 13, Math.PI * 1.8, Math.PI * 1.8, 1)[0], arc(118, 94, 13, 13, Math.PI * 1.6, Math.PI * 1.6, 1)[0], 7);
      pen.line(6, 2.6, [[98, 76], [138, 112]], { wobble: 0.3 });
      digit(pen, 2, 1, 44, 102, 14);
    }
  },
  retry: {
    size: ICON,
    paint(pen) {
      envelope(pen, 0, 54, 42, 52, 36);
      pen.line(3, 2.6, arc(80, 60, 50, 44, -Math.PI * 0.35, Math.PI * 1.25, 56), { wobble: 0.5 });
      const tip = arc(80, 60, 50, 44, Math.PI * 1.25, Math.PI * 1.25, 1)[0];
      const back = arc(80, 60, 50, 44, Math.PI * 1.12, Math.PI * 1.12, 1)[0];
      arrowHead(pen, 3, 2.6, tip, back, 10);
      envelope(pen, 1, 118, 88, 30, 20);
      pen.line(1, 1.6, [[104, 92], [112, 92]], { wobble: 0.1 });
    }
  },
  stamp: {
    size: ICON,
    paint(pen) {
      envelope(pen, 0, 22, 34, 86, 60);
      pen.line(3, 2.6, arc(110, 86, 22, 22, -Math.PI / 2, 1.5 * Math.PI, 32), { closed: true, wobble: 0.4 });
      digit(pen, 3, 1, 110, 86, 14);
      sparkle(pen, 140, 30, 8);
    }
  },
  ordered: {
    size: ICON,
    paint(pen) {
      [[14, 1], [62, 2], [110, 3]].forEach(([x, value], index) => {
        envelope(pen, [1, 5, 3][index], x, 46, 38, 28);
        digit(pen, [1, 5, 3][index], value, x + 19, 96, 12);
      });
      pen.line(0, 1.8, [[54, 60], [60, 60]], { wobble: 0.1 });
      pen.line(0, 1.8, [[102, 60], [108, 60]], { wobble: 0.1 });
      pen.line(3, 2.4, [[34, 22], [72, 18], [104, 24], [128, 18]], { wobble: 0.6 });
      arrowHead(pen, 3, 2.4, [136, 16], [124, 19]);
    }
  },
  gauge: {
    size: ICON,
    paint(pen) {
      pen.line(0, 2.6, arc(80, 92, 58, 58, Math.PI, 2 * Math.PI, 40), { wobble: 0.5 });
      pen.line(0, 2.4, [[22, 92], [138, 92]], { wobble: 0.3 });
      Array.from({ length: 7 }, (_, index) => Math.PI + Math.PI * index / 6).forEach((angle, index) => {
        pen.line(index > 4 ? 6 : 3, 2.2, [[80 + 50 * Math.cos(angle), 92 + 50 * Math.sin(angle)], [80 + 42 * Math.cos(angle), 92 + 42 * Math.sin(angle)]], { wobble: 0.1 });
      });
      pen.line(2, 2.6, [[80, 92], [58, 58]], { wobble: 0.2 });
      pen.dot(0, 9, 80, 92);
      sparkle(pen, 140, 26, 8);
    }
  },
  bug: {
    size: ICON,
    paint(pen) {
      pen.line(6, 2.6, arc(80, 70, 28, 36, -Math.PI / 2, 1.5 * Math.PI, 40), { closed: true });
      pen.line(0, 2.4, arc(80, 26, 14, 12, -Math.PI / 2, 1.5 * Math.PI, 24), { closed: true, wobble: 0.3 });
      pen.line(0, 2, [[80, 36], [80, 104]], { wobble: 0.3 });
      [[70, 58], [92, 72], [68, 84]].forEach(([x, y]) => pen.dot(0, 7, x, y));
      [[40, 50], [34, 72], [42, 96]].forEach(([x, y], index) => {
        pen.line(0, 2.2, [[54, 56 + index * 16], [x, y]], { wobble: 0.2 });
        pen.line(0, 2.2, [[106, 56 + index * 16], [160 - x, y]], { wobble: 0.2 });
      });
      pen.line(0, 2, spline([[74, 16], [66, 6], [56, 6]], false, 6), { wobble: 0.2 });
      pen.line(0, 2, spline([[86, 16], [94, 6], [104, 6]], false, 6), { wobble: 0.2 });
      pen.line(2, 2, [[122, 30], [132, 20]], { wobble: 0.1 });
      pen.line(2, 2, [[126, 42], [140, 40]], { wobble: 0.1 });
    }
  }
};
