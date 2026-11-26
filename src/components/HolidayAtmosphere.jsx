import { useEffect, useRef } from "react";

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/* ---------- Crisp Mini-Sprite Renderers ---------- */

function drawSnowflake(ctx, size, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.1, size * 0.15);
  ctx.lineCap = "round";
  for (let i = 0; i < 3; i += 1) {
    ctx.save();
    ctx.rotate((Math.PI / 3) * i);
    ctx.beginPath();
    ctx.moveTo(-size, 0);
    ctx.lineTo(size, 0);
    ctx.stroke();
    if (size >= 4.5) {
      ctx.beginPath();
      ctx.moveTo(size * 0.52, -size * 0.26);
      ctx.lineTo(size * 0.75, 0);
      ctx.lineTo(size * 0.52, size * 0.26);
      ctx.moveTo(-size * 0.52, -size * 0.26);
      ctx.lineTo(-size * 0.75, 0);
      ctx.lineTo(-size * 0.52, size * 0.26);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawPumpkin(ctx, size) {
  const w = size * 1.15;
  const h = size * 0.95;
  ctx.fillStyle = "#5aa84f";
  ctx.fillRect(-size * 0.14, -h * 0.74, size * 0.28, h * 0.28);
  ctx.fillStyle = "#f28524";
  ctx.beginPath();
  ctx.roundRect(-w * 0.55, -h * 0.48, w * 1.1, h * 0.98, size * 0.22);
  ctx.fill();
  ctx.strokeStyle = "#b54f0e";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#fff199";
  ctx.fillRect(-w * 0.32, -h * 0.18, w * 0.2, h * 0.2);
  ctx.fillRect(w * 0.12, -h * 0.18, w * 0.2, h * 0.2);
  ctx.fillRect(-w * 0.3, h * 0.14, w * 0.6, h * 0.15);
  ctx.fillStyle = "#c45c10";
  ctx.fillRect(-w * 0.08, h * 0.14, w * 0.14, h * 0.09);
}

function drawSkull(ctx, size) {
  const s = size * 0.95;
  ctx.fillStyle = "#f4effa";
  ctx.beginPath();
  ctx.roundRect(-s * 0.58, -s * 0.62, s * 1.16, s * 0.94, s * 0.24);
  ctx.fill();
  ctx.fillRect(-s * 0.36, s * 0.22, s * 0.72, s * 0.36);
  ctx.fillStyle = "#261636";
  ctx.fillRect(-s * 0.36, -s * 0.22, s * 0.26, s * 0.26);
  ctx.fillRect(s * 0.1, -s * 0.22, s * 0.26, s * 0.26);
  ctx.fillRect(-s * 0.08, s * 0.08, s * 0.16, s * 0.14);
  ctx.fillRect(-s * 0.2, s * 0.36, s * 0.09, s * 0.22);
  ctx.fillRect(0, s * 0.36, s * 0.09, s * 0.22);
  ctx.fillRect(s * 0.18, s * 0.36, s * 0.09, s * 0.22);
}

function drawBat(ctx, size) {
  ctx.fillStyle = "#241638";
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.2);
  ctx.lineTo(-size * 0.4, -size * 0.55);
  ctx.lineTo(-size * 1.2, -size * 0.1);
  ctx.lineTo(-size * 0.75, size * 0.35);
  ctx.lineTo(-size * 0.3, size * 0.1);
  ctx.lineTo(0, size * 0.35);
  ctx.lineTo(size * 0.3, size * 0.1);
  ctx.lineTo(size * 0.75, size * 0.35);
  ctx.lineTo(size * 1.2, -size * 0.1);
  ctx.lineTo(size * 0.4, -size * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ff9d42";
  ctx.fillRect(-size * 0.22, -size * 0.12, size * 0.14, size * 0.14);
  ctx.fillRect(size * 0.08, -size * 0.12, size * 0.14, size * 0.14);
}

function drawLantern(ctx, size, red = "#e84238", gold = "#ffd670") {
  ctx.fillStyle = gold;
  ctx.fillRect(-size * 0.28, -size * 0.72, size * 0.56, size * 0.18);
  ctx.fillRect(-size * 0.24, size * 0.5, size * 0.48, size * 0.16);
  ctx.fillStyle = red;
  ctx.beginPath();
  ctx.roundRect(-size * 0.52, -size * 0.56, size * 1.04, size * 1.08, size * 0.36);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 232, 148, 0.48)";
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.22, size * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = gold;
  ctx.lineWidth = Math.max(1.2, size * 0.12);
  ctx.beginPath();
  ctx.moveTo(0, size * 0.66);
  ctx.lineTo(0, size * 1.05);
  ctx.stroke();
}

function drawSkyLantern(ctx, size) {
  ctx.fillStyle = "#f5a53d";
  ctx.beginPath();
  ctx.moveTo(-size * 0.62, -size * 0.75);
  ctx.lineTo(size * 0.62, -size * 0.75);
  ctx.lineTo(size * 0.42, size * 0.68);
  ctx.lineTo(-size * 0.42, size * 0.68);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#fff8d6";
  ctx.beginPath();
  ctx.arc(0, size * 0.42, size * 0.22, 0, Math.PI * 2);
  ctx.fill();
}

function drawPixelHeart(ctx, size, color) {
  const u = size * 0.26;
  ctx.fillStyle = color;
  const cells = [
    [-2, -2], [-1, -2], [1, -2], [2, -2],
    [-3, -1], [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1], [3, -1],
    [-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0],
    [-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1],
    [-1, 2], [0, 2], [1, 2],
    [0, 3],
  ];
  for (const [cx, cy] of cells) {
    ctx.fillRect(cx * u - u * 0.5, cy * u - u * 0.5, u + 0.3, u + 0.3);
  }
}

function drawPetal(ctx, size, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.bezierCurveTo(size * 0.75, -size * 0.55, size * 0.75, size * 0.55, 0, size);
  ctx.bezierCurveTo(-size * 0.75, size * 0.55, -size * 0.75, -size * 0.55, 0, -size);
  ctx.fill();
}

function drawEasterEgg(ctx, size, color, stripe) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.65, size * 0.88, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = stripe;
  ctx.fillRect(-size * 0.58, -size * 0.12, size * 1.16, size * 0.22);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.arc(-size * 0.2, -size * 0.38, size * 0.14, 0, Math.PI * 2);
  ctx.fill();
}

function drawXpOrb(ctx, size, phase) {
  ctx.fillStyle = Math.sin(phase) > 0 ? "#8cf542" : "#cdfa52";
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.75, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f6ffaa";
  ctx.beginPath();
  ctx.arc(-size * 0.2, -size * 0.2, size * 0.26, 0, Math.PI * 2);
  ctx.fill();
}

function drawGrassBlock(ctx, size) {
  const s = size * 0.9;
  ctx.fillStyle = "#8a5c36";
  ctx.fillRect(-s * 0.5, -s * 0.5, s, s);
  ctx.fillStyle = "#62bd44";
  ctx.fillRect(-s * 0.5, -s * 0.5, s, s * 0.36);
}

function drawBambooLeaf(ctx, size, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-size * 1.05, 0);
  ctx.quadraticCurveTo(0, -size * 0.55, size * 1.05, 0);
  ctx.quadraticCurveTo(0, size * 0.55, -size * 1.05, 0);
  ctx.fill();
}

function drawZongzi(ctx, size) {
  ctx.fillStyle = "#4ba86a";
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.85);
  ctx.lineTo(size * 0.82, size * 0.62);
  ctx.lineTo(-size * 0.82, size * 0.62);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#f2d685";
  ctx.lineWidth = Math.max(1.2, size * 0.14);
  ctx.beginPath();
  ctx.moveTo(-size * 0.36, -size * 0.05);
  ctx.lineTo(size * 0.44, size * 0.25);
  ctx.stroke();
}

function drawCrescentMoon(ctx, size, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.85, 0.35, Math.PI * 2 - 0.35);
  ctx.quadraticCurveTo(-size * 0.1, 0, size * 0.78, -size * 0.28);
  ctx.closePath();
  ctx.fill();
}

function drawMapleLeaf(ctx, size, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.25, -size * 0.35);
  ctx.lineTo(size * 0.9, -size * 0.42);
  ctx.lineTo(size * 0.45, size * 0.05);
  ctx.lineTo(size * 0.72, size * 0.58);
  ctx.lineTo(size * 0.12, size * 0.38);
  ctx.lineTo(0, size * 0.92);
  ctx.lineTo(-size * 0.12, size * 0.38);
  ctx.lineTo(-size * 0.72, size * 0.58);
  ctx.lineTo(-size * 0.45, size * 0.05);
  ctx.lineTo(-size * 0.9, -size * 0.42);
  ctx.lineTo(-size * 0.25, -size * 0.35);
  ctx.closePath();
  ctx.fill();
}

function drawStar(ctx, size, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const r = i % 2 === 0 ? size : size * 0.36;
    const angle = (Math.PI / 4) * i;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawDiamond(ctx, size, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.65, 0);
  ctx.lineTo(0, size);
  ctx.lineTo(-size * 0.65, 0);
  ctx.closePath();
  ctx.fill();
}

function createAmbientParticle(holidayId, width, height, randomY = true) {
  const y = randomY ? rand(0, height) : -rand(10, 50);
  switch (holidayId) {
    case "christmas":
      return {
        kind: Math.random() < 0.32 ? "snowflake" : "snowdot",
        x: rand(0, width),
        y,
        vx: rand(-12, 16),
        vy: rand(24, 54),
        size: rand(2.4, 5.5),
        rot: rand(0, Math.PI * 2),
        vrot: rand(-1, 1),
        alpha: rand(0.36, 0.76),
        color: Math.random() < 0.15 ? "#fff4cc" : "#ffffff",
        phase: rand(0, Math.PI * 2),
      };
    case "springfestival":
      return {
        kind: Math.random() < 0.22 ? "lantern" : "goldleaf",
        x: rand(0, width),
        y,
        vx: rand(-10, 14),
        vy: rand(18, 40),
        size: rand(3.5, 6.2),
        rot: rand(0, Math.PI * 2),
        vrot: rand(-1.5, 1.5),
        alpha: rand(0.36, 0.72),
        color: pick(["#ffd670", "#ff9e5e", "#f25749"]),
        phase: rand(0, Math.PI * 2),
      };
    case "newyear":
      return {
        kind: "star",
        x: rand(0, width),
        y: rand(0, height),
        vx: rand(-5, 5),
        vy: rand(-14, -5),
        size: rand(2.5, 5.2),
        rot: rand(0, Math.PI),
        vrot: rand(-0.7, 0.7),
        alpha: rand(0.3, 0.7),
        color: pick(["#ffe08a", "#78ceff", "#ffffff", "#ffb470"]),
        phase: rand(0, Math.PI * 2),
      };
    case "valentines":
      return {
        kind: Math.random() < 0.22 ? "heart" : "petal",
        x: rand(0, width),
        y,
        vx: rand(12, 30),
        vy: rand(20, 40),
        size: rand(4, 6.8),
        rot: rand(0, Math.PI * 2),
        vrot: rand(-1.4, 1.4),
        alpha: rand(0.4, 0.74),
        color: pick(["#ff9ec4", "#ffbdd8", "#f26b9c", "#ffe0ed"]),
        phase: rand(0, Math.PI * 2),
      };
    case "easter":
      return {
        kind: "mote",
        x: rand(0, width),
        y: randomY ? rand(0, height) : height + 16,
        vx: rand(-9, 9),
        vy: rand(-20, -8),
        size: rand(3.5, 6.2),
        rot: 0,
        vrot: 0,
        alpha: rand(0.32, 0.66),
        color: pick(["#9ef0ad", "#c9a8ff", "#ffe28a", "#9ce8ff"]),
        phase: rand(0, Math.PI * 2),
      };
    case "mc-anniversary":
      return {
        kind: Math.random() < 0.35 ? "xp" : "pixel",
        x: rand(0, width),
        y: randomY ? rand(0, height) : height + 16,
        vx: rand(-8, 8),
        vy: rand(-24, -10),
        size: rand(3.5, 6.8),
        rot: 0,
        vrot: 0,
        alpha: rand(0.34, 0.7),
        color: pick(["#8ef26b", "#d8ff66", "#73c954", "#e6b873"]),
        phase: rand(0, Math.PI * 2),
      };
    case "dragonboat":
      return {
        kind: "bamboo",
        x: rand(0, width),
        y,
        vx: rand(16, 34),
        vy: rand(18, 32),
        size: rand(4.8, 8),
        rot: rand(0, Math.PI * 2),
        vrot: rand(-1.3, 1.3),
        alpha: rand(0.36, 0.68),
        color: pick(["#57c29e", "#88d47b", "#a7ebd0"]),
        phase: rand(0, Math.PI * 2),
      };
    case "midautumn":
      return {
        kind: Math.random() < 0.16 ? "skylantern" : "osmanthus",
        x: rand(0, width),
        y: randomY ? rand(0, height) : height + 24,
        vx: rand(-8, 10),
        vy: rand(-20, -8),
        size: rand(3, 6.2),
        rot: rand(0, Math.PI * 2),
        vrot: rand(-0.5, 0.5),
        alpha: rand(0.36, 0.74),
        color: pick(["#ffe59e", "#f5c45e", "#fff4cc"]),
        phase: rand(0, Math.PI * 2),
      };
    case "halloween":
      return {
        kind: Math.random() < 0.2 ? "bat" : "ember",
        x: rand(0, width),
        y: randomY ? rand(0, height) : height + 20,
        vx: rand(-20, 20),
        vy: rand(-22, -8),
        size: rand(4, 7),
        rot: 0,
        vrot: 0,
        alpha: rand(0.36, 0.72),
        color: pick(["#ff9438", "#b980ff", "#ffba66"]),
        phase: rand(0, Math.PI * 2),
      };
    case "thanksgiving":
    default:
      return {
        kind: "maple",
        x: rand(0, width),
        y,
        vx: rand(14, 32),
        vy: rand(20, 40),
        size: rand(5, 8.8),
        rot: rand(0, Math.PI * 2),
        vrot: rand(-1.6, 1.6),
        alpha: rand(0.4, 0.74),
        color: pick(["#e35e36", "#f09a3e", "#f5c258", "#c9482e"]),
        phase: rand(0, Math.PI * 2),
      };
  }
}

function createTrailParticle(holidayId, x, y, dx, dy, accent) {
  const vx = dx * 0.16 + rand(-18, 18);
  const vy = dy * 0.16 + rand(-18, 18);
  let kind = "star";
  let color = "#ffffff";
  let stripe = "#ffffff";
  let size = rand(3.2, 5.4);
  let gravity = 32;

  if (!holidayId) {
    const base = accent || "#6f9f94";
    kind = Math.random() < 0.45 ? "diamond" : Math.random() < 0.5 ? "star" : "mote";
    color = pick([base, base, "#9dffcd", "#61cfff", "#ffffff"]);
    size = kind === "mote" ? rand(2.6, 4.4) : rand(3.2, 5.2);
    gravity = 18;
  } else {
    switch (holidayId) {
      case "christmas":
        kind = Math.random() < 0.45 ? "snowflake" : "snowdot";
        color = Math.random() < 0.25 ? "#fff4cc" : "#ffffff";
        size = kind === "snowflake" ? rand(4, 6.2) : rand(2.5, 4.2);
        gravity = 38;
        break;
      case "halloween":
        kind =
          Math.random() < 0.18
            ? "pumpkin"
            : Math.random() < 0.14
              ? "skull"
              : "ember";
        color = pick(["#ff9438", "#b980ff", "#ffba66"]);
        size = kind === "ember" ? rand(3.2, 5.2) : rand(5.2, 7.2);
        gravity = -24;
        break;
      case "springfestival":
        kind = Math.random() < 0.35 ? "goldleaf" : "star";
        color = pick(["#ffd670", "#f25549", "#ffb357"]);
        size = rand(3.4, 5.4);
        gravity = 24;
        break;
      case "newyear":
        kind = Math.random() < 0.55 ? "star" : "spark";
        color = pick(["#ffe08a", "#70c8ff", "#ff96a8", "#ffffff"]);
        size = rand(3.2, 5.5);
        gravity = 28;
        break;
      case "valentines":
        kind = Math.random() < 0.45 ? "heart" : "petal";
        color = pick(["#ff6b9d", "#ffa6c8", "#ff477e"]);
        size = kind === "heart" ? rand(3.8, 5.6) : rand(3.6, 5.4);
        gravity = -18;
        break;
      case "easter":
        kind = Math.random() < 0.28 ? "egg" : "mote";
        color = pick(["#9ef0ad", "#c9a8ff", "#ffe28a", "#9ce8ff"]);
        stripe = "#ffffff";
        size = kind === "egg" ? rand(4.6, 6.4) : rand(3.2, 5);
        gravity = 42;
        break;
      case "mc-anniversary":
        kind = Math.random() < 0.5 ? "xp" : "pixel";
        color = pick(["#8ef26b", "#d8ff66", "#73c954"]);
        size = rand(3.6, 5.6);
        gravity = 26;
        break;
      case "dragonboat":
        kind = Math.random() < 0.55 ? "bamboo" : "mote";
        color = pick(["#57c29e", "#88d47b", "#a7ebd0"]);
        size = rand(4, 6.2);
        gravity = 24;
        break;
      case "midautumn":
        kind = Math.random() < 0.24 ? "moon" : "osmanthus";
        color = pick(["#ffe59e", "#f0c36d", "#fff6d6"]);
        size = kind === "moon" ? rand(4.5, 6.4) : rand(3, 4.8);
        gravity = -16;
        break;
      case "thanksgiving":
      default:
        kind = Math.random() < 0.55 ? "maple" : "ember";
        color = pick(["#e35e36", "#f09a3e", "#f5c258"]);
        size = kind === "maple" ? rand(4.5, 6.8) : rand(3, 4.6);
        gravity = 34;
        break;
    }
  }

  return {
    kind,
    x: x + rand(-3, 3),
    y: y + rand(-3, 3),
    vx,
    vy,
    gravity,
    size,
    rot: rand(0, Math.PI * 2),
    vrot: rand(-2.8, 2.8),
    life: 0,
    maxLife: rand(0.36, 0.56),
    color,
    stripe,
    phase: rand(0, Math.PI * 2),
    shrink: true,
  };
}

function createClickBurst(holidayId, x, y, count = 8, accent = "#6f9f94") {
  const sprites = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count + rand(-0.35, 0.35);
    const speed = rand(65, 160);
    let kind = "star";
    let color = "#ffffff";
    let stripe = "#ffffff";
    let size = rand(6, 9.5);
    let gravity = 200;

    if (!holidayId) {
      const base = accent || "#6f9f94";
      kind = i % 3 === 0 ? "diamond" : i % 3 === 1 ? "star" : "mote";
      color = pick([base, base, "#9dffcd", "#61cfff", "#ffffff"]);
      size = kind === "mote" ? rand(4.5, 7) : rand(5.8, 9);
      gravity = 155;
    } else {
      switch (holidayId) {
        case "halloween":
          kind = i % 3 === 0 ? "pumpkin" : i % 3 === 1 ? "skull" : "star";
          color = pick(["#ff9438", "#b980ff", "#ffcf70"]);
          size = kind === "star" ? rand(5, 8) : rand(8.5, 12);
          gravity = 160;
          break;
        case "christmas":
          kind = i % 3 === 0 ? "snowflake" : i % 3 === 1 ? "star" : "ornament";
          color =
            kind === "snowflake"
              ? "#ffffff"
              : pick(["#f5cf7b", "#e85c54", "#6ad49c", "#ffffff"]);
          size = kind === "snowflake" ? rand(7, 10.5) : rand(5, 8.5);
          gravity = 135;
          break;
        case "springfestival":
          kind = i % 3 === 0 ? "lantern" : i % 3 === 1 ? "star" : "goldleaf";
          color = pick(["#ffd670", "#f24c44", "#ffb55e"]);
          size = kind === "lantern" ? rand(8, 11) : rand(5, 8.5);
          gravity = 155;
          break;
        case "newyear":
          kind = i % 2 === 0 ? "star" : "spark";
          color = pick(["#ffe08a", "#70c8ff", "#ff8c7a", "#ffffff"]);
          size = rand(5, 9.5);
          gravity = 180;
          break;
        case "valentines":
          kind = i % 2 === 0 ? "heart" : "petal";
          color = pick(["#ff6b9d", "#ff9cc2", "#ff477e", "#ffd4e5"]);
          size = kind === "heart" ? rand(6.5, 9.5) : rand(6, 9);
          gravity = 85;
          break;
        case "easter":
          kind = i % 3 === 0 ? "egg" : "star";
          color = pick(["#9ef0ad", "#c9a8ff", "#ffe28a", "#9ce8ff", "#ffb3c8"]);
          stripe = pick(["#ffffff", "#ffdf78", "#9e6cf2"]);
          size = kind === "egg" ? rand(7.5, 10.5) : rand(5, 8);
          gravity = 240;
          break;
        case "mc-anniversary":
          kind = i % 3 === 0 ? "grass" : "xp";
          color = pick(["#8ef26b", "#d8ff66"]);
          size = kind === "grass" ? rand(8, 11) : rand(6.5, 9.5);
          gravity = 220;
          break;
        case "dragonboat":
          kind = i % 3 === 0 ? "zongzi" : i % 3 === 1 ? "bamboo" : "ripple";
          color = pick(["#57c29e", "#88d47b", "#9ef2d5"]);
          size = rand(7, 10.5);
          gravity = 140;
          break;
        case "midautumn":
          kind = i % 3 === 0 ? "moon" : "star";
          color = pick(["#ffe59e", "#f0c36d", "#fff6d6"]);
          size = kind === "moon" ? rand(7.5, 10.5) : rand(5, 8);
          gravity = 95;
          break;
        case "thanksgiving":
        default:
          kind = i % 3 === 0 ? "star" : "maple";
          color = pick(["#e35e36", "#f09a3e", "#f5c258", "#c9482e"]);
          size = kind === "maple" ? rand(7.5, 11) : rand(5, 7.5);
          gravity = 150;
          break;
      }
    }

    sprites.push({
      kind,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - rand(40, 90),
      gravity,
      size,
      rot: rand(0, Math.PI * 2),
      vrot: rand(-4, 4),
      life: 0,
      maxLife: rand(0.58, 0.9),
      color,
      stripe,
      phase: rand(0, Math.PI * 2),
      shrink: false,
    });
  }
  return sprites;
}

function drawSprite(ctx, item, nowSec, scale = 1) {
  const size = item.size * scale;
  if (size <= 0.3) return;
  ctx.save();
  ctx.translate(item.x, item.y);
  if (item.rot) ctx.rotate(item.rot);
  switch (item.kind) {
    case "snowflake":
      drawSnowflake(ctx, size, item.color);
      break;
    case "snowdot":
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.65, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "ornament":
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.72, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.beginPath();
      ctx.arc(-size * 0.22, -size * 0.22, size * 0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "pumpkin":
      drawPumpkin(ctx, size);
      break;
    case "skull":
      drawSkull(ctx, size);
      break;
    case "bat":
      ctx.scale(1, 0.75 + 0.35 * Math.sin(nowSec * 12 + item.phase));
      drawBat(ctx, size);
      break;
    case "lantern":
      drawLantern(ctx, size);
      break;
    case "skylantern":
      drawSkyLantern(ctx, size);
      break;
    case "goldleaf":
      ctx.fillStyle = item.color;
      ctx.fillRect(-size * 0.5, -size * 0.35, size, size * 0.7);
      break;
    case "heart":
      drawPixelHeart(ctx, size, item.color);
      break;
    case "petal":
      drawPetal(ctx, size, item.color);
      break;
    case "egg":
      drawEasterEgg(ctx, size, item.color, item.stripe || "#ffffff");
      break;
    case "xp":
      drawXpOrb(ctx, size, nowSec * 8 + item.phase);
      break;
    case "grass":
      drawGrassBlock(ctx, size);
      break;
    case "pixel":
      ctx.fillStyle = item.color;
      ctx.fillRect(-size * 0.45, -size * 0.45, size * 0.9, size * 0.9);
      break;
    case "bamboo":
      drawBambooLeaf(ctx, size, item.color);
      break;
    case "zongzi":
      drawZongzi(ctx, size);
      break;
    case "moon":
      drawCrescentMoon(ctx, size, item.color);
      break;
    case "maple":
      drawMapleLeaf(ctx, size, item.color);
      break;
    case "ripple": {
      const progress = Math.max(0, item.life / item.maxLife);
      ctx.strokeStyle = item.color;
      ctx.lineWidth = Math.max(1.2, 2.4 * (1 - progress));
      ctx.beginPath();
      ctx.arc(0, 0, size + progress * 26, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "ember":
    case "mote":
    case "osmanthus":
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.72, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "diamond":
      drawDiamond(ctx, size, item.color);
      break;
    case "spark":
      ctx.fillStyle = item.color;
      ctx.fillRect(-size * 0.32, -size * 0.32, size * 0.64, size * 0.64);
      break;
    case "star":
    default:
      drawStar(ctx, size, item.color);
      break;
  }
  ctx.restore();
}

export function HolidayAtmosphere({
  holidayId,
  accent = "#6f9f94",
  enabled,
  appRoot,
  page,
}) {
  const canvasRef = useRef(null);
  const pageRef = useRef(page);
  const accentRef = useRef(accent);
  const pauseAmbientUntil = useRef(0);

  useEffect(() => {
    accentRef.current = accent;
  }, [accent]);

  useEffect(() => {
    pageRef.current = page;
    pauseAmbientUntil.current = performance.now() + 240;
  }, [page]);

  useEffect(() => {
    if (!enabled) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const canvas = canvasRef.current;
    const host = appRoot?.current;
    if (!canvas || !host) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Single top overlay canvas (above all backdrop-filter elements) so redraws
    // NEVER invalidate browser backdrop-filter blur caches on Download / Library.
    let width = host.clientWidth || 1080;
    let height = host.clientHeight || 720;
    let dpr = Math.min(1.5, window.devicePixelRatio || 1);

    const resize = () => {
      width = Math.max(320, host.clientWidth || window.innerWidth);
      height = Math.max(240, host.clientHeight || window.innerHeight);
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const ambientCount = !holidayId ? 0 : holidayId === "christmas" ? 22 : 16;
    const ambient = Array.from({ length: ambientCount }, () =>
      createAmbientParticle(holidayId, width, height, true),
    );
    const fx = [];
    const MAX_FX = 120;

    let lastClickAt = 0;
    let lastTrailAt = 0;
    let lastMouseX = null;
    let lastMouseY = null;
    let frameId = 0;
    let lastTime = performance.now();

    const tick = (now) => {
      frameId = 0;
      if (document.hidden) return;
      const hasInteractiveFx = fx.length > 0;
      const hasAmbient = ambient.length > 0;
      const elapsed = now - lastTime;

      if (hasInteractiveFx || (hasAmbient && elapsed >= 32)) {
        const dt = Math.min(0.05, Math.max(0.004, elapsed / 1000));
        lastTime = now;
        const nowSec = now / 1000;
        const isHome = pageRef.current === "home";
        const ambientScale = isHome ? 1 : 0.45;
        const updateAmbient = now >= pauseAmbientUntil.current;

        ctx.clearRect(0, 0, width, height);

        for (let i = 0; i < ambient.length; i += 1) {
          const p = ambient[i];
          if (updateAmbient) {
            p.x += (p.vx + Math.sin(nowSec * 1.2 + p.phase) * 12) * dt;
            p.y += p.vy * dt;
            p.rot += p.vrot * dt;
            const outBottom = p.vy > 0 && p.y > height + 30;
            const outTop = p.vy < 0 && p.y < -30;
            const outSides = p.x < -50 || p.x > width + 50;
            if (outBottom || outTop || outSides) {
              ambient[i] = createAmbientParticle(holidayId, width, height, false);
              if (outSides && !outBottom && !outTop) {
                ambient[i].x = p.vx >= 0 ? -18 : width + 18;
                ambient[i].y = rand(0, height);
              }
              continue;
            }
          }
          ctx.globalAlpha =
            (p.kind === "star" || p.kind === "ember"
              ? p.alpha * (0.55 + 0.45 * Math.sin(nowSec * 2.4 + p.phase))
              : p.alpha) * ambientScale;
          drawSprite(ctx, p, nowSec);
        }

        for (let i = fx.length - 1; i >= 0; i -= 1) {
          const item = fx[i];
          item.life += dt;
          if (item.life >= item.maxLife) {
            fx.splice(i, 1);
            continue;
          }
          item.vy += item.gravity * dt;
          item.x += item.vx * dt;
          item.y += item.vy * dt;
          item.rot += item.vrot * dt;
          const progress = item.life / item.maxLife;
          const fade = item.shrink
            ? Math.max(0, 1 - progress)
            : progress < 0.68
              ? 1
              : Math.max(0, (1 - progress) / 0.32);
          ctx.globalAlpha = fade * (item.shrink ? 0.86 : 0.94);
          drawSprite(ctx, item, nowSec, item.shrink ? 1 - progress * 0.45 : 1);
        }
        ctx.globalAlpha = 1;
      }

      if (ambient.length > 0 || fx.length > 0) {
        frameId = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, width, height);
      }
    };

    const start = () => {
      if (!frameId && !document.hidden && (ambient.length > 0 || fx.length > 0)) {
        lastTime = performance.now();
        frameId = requestAnimationFrame(tick);
      }
    };

    const onPointerDown = (event) => {
      if (event.button !== 0) return;
      const now = performance.now();
      if (now - lastClickAt < 65) return;
      lastClickAt = now;
      const rect = host.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      fx.push(...createClickBurst(holidayId, x, y, 8, accentRef.current));
      if (fx.length > MAX_FX) fx.splice(0, fx.length - MAX_FX);
      start();
    };

    const onPointerMove = (event) => {
      if (event.pointerType === "touch") return;
      const now = performance.now();
      const rect = host.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (lastMouseX == null || lastMouseY == null) {
        lastMouseX = x;
        lastMouseY = y;
        return;
      }
      const dx = x - lastMouseX;
      const dy = y - lastMouseY;
      const distSq = dx * dx + dy * dy;
      if (distSq < 196 || now - lastTrailAt < 20) return;
      lastTrailAt = now;
      lastMouseX = x;
      lastMouseY = y;
      fx.push(createTrailParticle(holidayId, x, y, dx, dy, accentRef.current));
      if (fx.length > MAX_FX) fx.splice(0, fx.length - MAX_FX);
      start();
    };

    const onPointerLeave = () => {
      lastMouseX = null;
      lastMouseY = null;
    };

    host.addEventListener("pointerdown", onPointerDown, true);
    host.addEventListener("pointermove", onPointerMove, { passive: true });
    host.addEventListener("pointerleave", onPointerLeave);
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(host);

    const onVisibility = () => {
      if (document.hidden && frameId) {
        cancelAnimationFrame(frameId);
        frameId = 0;
      } else {
        start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      host.removeEventListener("pointerdown", onPointerDown, true);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      resizeObserver?.disconnect();
    };
  }, [holidayId, enabled, appRoot]);

  if (!enabled) return null;
  return (
    <canvas ref={canvasRef} className="holiday-fx-canvas" aria-hidden="true" />
  );
}
