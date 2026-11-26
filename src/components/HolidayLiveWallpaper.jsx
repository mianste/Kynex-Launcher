import { useEffect, useRef } from "react";

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/* ---------- Per-Holiday Living Scene Generators ---------- */

function initSceneState(holidayId) {
  const state = {
    sparks: [],
    smoke: [],
    fwParticles: [],
    lanterns: [],
    bats: [],
    butterflies: [],
    twinkles: [],
    flakes: [],
    ripples: [],
    nextFireworkAt: 0.4,
  };

  if (holidayId === "thanksgiving") {
    for (let i = 0; i < 24; i += 1) {
      state.sparks.push({
        x: 0.7 + rand(-0.03, 0.03),
        y: 0.72 - rand(0, 0.35),
        vx: rand(-0.015, 0.025),
        vy: -rand(0.055, 0.13),
        size: rand(1.6, 3.6),
        life: rand(0, 1),
        color: pick(["#ffcf66", "#ff8d33", "#ffe99e", "#ff6824"]),
      });
    }
    for (let i = 0; i < 16; i += 1) {
      const isChimney = i % 2 === 0;
      state.smoke.push({
        source: isChimney ? "chimney" : "fire",
        x: isChimney ? 0.724 + rand(-0.008, 0.008) : 0.702 + rand(-0.015, 0.015),
        y: isChimney ? 0.25 - rand(0, 0.24) : 0.67 - rand(0, 0.28),
        vx: rand(0.008, 0.024),
        vy: -rand(0.032, 0.062),
        radius: rand(12, 26),
        life: rand(0, 1),
      });
    }
    for (let i = 0; i < 20; i += 1) {
      state.flakes.push({
        x: rand(0, 1),
        y: rand(0, 1),
        vx: rand(0.025, 0.065),
        vy: rand(0.028, 0.065),
        size: rand(4.5, 9),
        rot: rand(0, Math.PI * 2),
        vrot: rand(-2.2, 2.2),
        color: pick(["#e85a30", "#f29d38", "#f7c954", "#cf4528"]),
        phase: rand(0, Math.PI * 2),
      });
    }
  } else if (holidayId === "christmas") {
    const hotspots = [
      [0.78, 0.22], [0.76, 0.30], [0.80, 0.34], [0.74, 0.42], [0.79, 0.44],
      [0.84, 0.46], [0.72, 0.54], [0.78, 0.56], [0.83, 0.58], [0.88, 0.60],
      [0.71, 0.66], [0.77, 0.68], [0.82, 0.70], [0.87, 0.72],
      [0.24, 0.74], [0.43, 0.67], [0.62, 0.64], [0.775, 0.07],
    ];
    for (const [hx, hy] of hotspots) {
      state.twinkles.push({
        x: hx + rand(-0.015, 0.015),
        y: hy + rand(-0.015, 0.015),
        size: rand(4, 10),
        phase: rand(0, Math.PI * 2),
        speed: rand(2.2, 4.6),
        color: pick(["#ffe899", "#ff7766", "#8affbe", "#fff8d6"]),
      });
    }
    const chimneys = [
      [0.18, 0.50],
      [0.425, 0.52],
      [0.59, 0.54],
    ];
    for (let i = 0; i < 15; i += 1) {
      const [cx, cy] = chimneys[i % chimneys.length];
      state.smoke.push({
        cx,
        cy,
        x: cx,
        y: cy - rand(0, 0.22),
        vx: rand(0.008, 0.022),
        vy: -rand(0.03, 0.055),
        radius: rand(10, 22),
        life: rand(0, 1),
      });
    }
    for (let i = 0; i < 72; i += 1) {
      state.flakes.push({
        x: rand(0, 1),
        y: rand(0, 1),
        vx: rand(-0.02, 0.015),
        vy: rand(0.045, 0.12),
        size: rand(1.4, 4.2),
        alpha: rand(0.35, 0.9),
        phase: rand(0, Math.PI * 2),
      });
    }
  } else if (holidayId === "newyear" || holidayId === "springfestival") {
    for (let i = 0; i < 24; i += 1) {
      state.ripples.push({
        x: rand(0.14, 0.88),
        y: rand(0.68, 0.98),
        w: rand(22, 74),
        phase: rand(0, Math.PI * 2),
        speed: rand(1.6, 3.2),
      });
    }
    for (let i = 0; i < 28; i += 1) {
      state.sparks.push({
        x: rand(0, 1),
        y: rand(0, 1),
        vx: rand(-0.012, 0.012),
        vy: holidayId === "springfestival" ? rand(0.018, 0.042) : -rand(0.012, 0.03),
        size: rand(1.5, 3.2),
        life: rand(0, 1),
        color:
          holidayId === "springfestival"
            ? pick(["#ffd870", "#ff6852", "#ffffff"])
            : pick(["#ffe08a", "#8fd4ff", "#ffffff"]),
      });
    }
  } else if (holidayId === "halloween") {
    for (let i = 0; i < 9; i += 1) {
      const dir = i % 2 === 0 ? 1 : -1;
      state.bats.push({
        x: rand(0, 1),
        y: rand(0.08, 0.42),
        vx: dir * rand(0.045, 0.1),
        vy: rand(-0.01, 0.01),
        size: rand(6, 12),
        phase: rand(0, Math.PI * 2),
      });
    }
    for (let i = 0; i < 22; i += 1) {
      state.sparks.push({
        x: rand(0.14, 0.86),
        y: rand(0.48, 0.96),
        vx: rand(-0.01, 0.01),
        vy: -rand(0.028, 0.065),
        size: rand(2, 4.2),
        life: rand(0, 1),
        color: pick(["#ff9b38", "#c28bff", "#ffe084"]),
      });
    }
  } else if (holidayId === "midautumn") {
    for (let i = 0; i < 26; i += 1) {
      state.ripples.push({
        x: rand(0.04, 0.62),
        y: rand(0.52, 0.98),
        w: rand(28, 86),
        phase: rand(0, Math.PI * 2),
        speed: rand(1.4, 2.8),
      });
    }
    for (let i = 0; i < 14; i += 1) {
      state.lanterns.push({
        x: rand(0.05, 0.74),
        y: rand(0.02, 0.68),
        vx: rand(-0.008, 0.008),
        vy: -rand(0.016, 0.036),
        size: rand(5, 11),
        phase: rand(0, Math.PI * 2),
      });
    }
  } else if (holidayId === "valentines") {
    for (let i = 0; i < 20; i += 1) {
      state.ripples.push({
        x: rand(0.24, 0.94),
        y: rand(0.66, 0.98),
        w: rand(24, 68),
        phase: rand(0, Math.PI * 2),
        speed: rand(1.4, 2.6),
      });
    }
    for (let i = 0; i < 36; i += 1) {
      state.flakes.push({
        x: rand(0, 1),
        y: rand(0, 1),
        vx: rand(0.024, 0.06),
        vy: rand(0.022, 0.052),
        size: rand(4, 8),
        rot: rand(0, Math.PI * 2),
        vrot: rand(-2.4, 2.4),
        color: pick(["#ff9ec2", "#ffc2da", "#ff74a6", "#ffe3ef"]),
        phase: rand(0, Math.PI * 2),
      });
    }
  } else if (holidayId === "easter") {
    for (let i = 0; i < 12; i += 1) {
      state.butterflies.push({
        x: rand(0.08, 0.92),
        y: rand(0.24, 0.85),
        vx: rand(-0.038, 0.038),
        vy: rand(-0.022, 0.022),
        size: rand(5, 9),
        color: pick(["#ff90c6", "#ffe066", "#7be0ff", "#c796ff", "#ffffff"]),
        phase: rand(0, Math.PI * 2),
      });
    }
  } else if (holidayId === "mc-anniversary") {
    for (let i = 0; i < 14; i += 1) {
      state.smoke.push({
        x: 0.8 + rand(-0.04, 0.04),
        y: 0.88 - rand(0, 0.2),
        vx: rand(-0.018, 0.018),
        vy: -rand(0.026, 0.058),
        radius: rand(14, 32),
        life: rand(0, 1),
      });
    }
    for (let i = 0; i < 30; i += 1) {
      state.sparks.push({
        x: rand(0.08, 0.92),
        y: rand(0.15, 0.98),
        vx: rand(-0.01, 0.012),
        vy: -rand(0.026, 0.062),
        size: rand(2.2, 4.5),
        life: rand(0, 1),
        color: pick(["#b8ff62", "#ffe666", "#70e8ff", "#ffffff"]),
      });
    }
  } else if (holidayId === "dragonboat") {
    for (let i = 0; i < 26; i += 1) {
      state.ripples.push({
        x: rand(0.08, 0.86),
        y: rand(0.58, 0.98),
        w: rand(28, 78),
        phase: rand(0, Math.PI * 2),
        speed: rand(1.8, 3.2),
      });
    }
    for (let i = 0; i < 20; i += 1) {
      state.flakes.push({
        x: rand(0, 1),
        y: rand(0, 1),
        vx: rand(0.026, 0.062),
        vy: rand(0.018, 0.044),
        size: rand(5, 9.5),
        rot: rand(0, Math.PI * 2),
        vrot: rand(-2, 2),
        color: pick(["#6ad47e", "#9ce884", "#44b36d", "#c2f29b"]),
        phase: rand(0, Math.PI * 2),
      });
    }
  }

  return state;
}

/* ---------- Overlay Renderers ---------- */

function drawMiniLeaf(ctx, x, y, size, rot, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, size, size * 0.44, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMiniBat(ctx, x, y, size, flap) {
  const wingY = Math.sin(flap) * size * 0.5;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(18, 12, 30, 0.9)";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-size * 0.55, -size * 0.4 + wingY, -size * 1.2, wingY * 0.7);
  ctx.quadraticCurveTo(-size * 0.6, size * 0.25, 0, size * 0.15);
  ctx.quadraticCurveTo(size * 0.6, size * 0.25, size * 1.2, wingY * 0.7);
  ctx.quadraticCurveTo(size * 0.55, -size * 0.4 + wingY, 0, 0);
  ctx.fill();
  ctx.restore();
}

function drawWaterShimmer(ctx, ripples, width, height, nowSec, tint) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (const r of ripples) {
    const a = 0.06 + 0.14 * (0.5 + 0.5 * Math.sin(nowSec * r.speed + r.phase));
    const px = (r.x + Math.sin(nowSec * 0.7 + r.phase) * 0.012) * width;
    const py = r.y * height;
    ctx.fillStyle = tint.replace("ALPHA", a.toFixed(3));
    ctx.fillRect(px - r.w * 0.5, py, r.w, 2.2);
  }
  ctx.restore();
}

function drawGodRays(ctx, width, height, nowSec, tintA, tintB) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 4; i += 1) {
    const shift = Math.sin(nowSec * 0.45 + i * 1.7) * width * 0.04;
    const x = width * (0.18 + i * 0.22) + shift;
    const w = width * (0.1 + (i % 2) * 0.05);
    const alpha = 0.05 + 0.045 * (0.5 + 0.5 * Math.sin(nowSec * 0.7 + i * 2.1));
    const grad = ctx.createLinearGradient(x, 0, x - width * 0.14, height * 0.92);
    grad.addColorStop(0, tintA.replace("ALPHA", alpha.toFixed(3)));
    grad.addColorStop(0.65, tintB.replace("ALPHA", (alpha * 0.55).toFixed(3)));
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.35, 0);
    ctx.lineTo(x + w * 0.35, 0);
    ctx.lineTo(x + w * 0.65 - width * 0.14, height);
    ctx.lineTo(x - w * 0.65 - width * 0.14, height);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawAurora(ctx, width, height, nowSec) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let band = 0; band < 2; band += 1) {
    const baseY = height * (0.14 + band * 0.09);
    const grad = ctx.createLinearGradient(0, baseY - 40, width, baseY + 60);
    grad.addColorStop(0, "rgba(64, 214, 168, 0)");
    grad.addColorStop(0.3, band === 0 ? "rgba(74, 232, 184, 0.16)" : "rgba(130, 164, 255, 0.14)");
    grad.addColorStop(0.7, band === 0 ? "rgba(120, 224, 255, 0.14)" : "rgba(182, 120, 255, 0.12)");
    grad.addColorStop(1, "rgba(74, 232, 184, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    for (let x = 0; x <= width; x += 64) {
      const y = baseY + Math.sin(x * 0.005 + nowSec * (0.6 + band * 0.25) + band * 2) * 26;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, baseY + 70);
    ctx.lineTo(0, baseY + 70);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawFogBank(ctx, width, height, nowSec, color, yRatio, speed) {
  ctx.save();
  const offset = ((nowSec * speed) % 1) * width;
  for (let k = -1; k <= 1; k += 1) {
    const cx = offset + k * width;
    const cy = height * yRatio;
    const grad = ctx.createRadialGradient(cx, cy, 20, cx, cy, width * 0.55);
    grad.addColorStop(0, color);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy, width * 0.62, height * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSceneOverlay(ctx, holidayId, state, width, height, dt, nowSec) {
  switch (holidayId) {
    case "thanksgiving": {
      drawGodRays(
        ctx,
        width,
        height,
        nowSec,
        "rgba(255, 212, 128, ALPHA)",
        "rgba(255, 168, 92, ALPHA)",
      );
      const flicker =
        0.78 +
        0.16 * Math.sin(nowSec * 11.3) +
        0.08 * Math.sin(nowSec * 23.7);
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const fx = width * 0.702;
      const fy = height * 0.705;
      const fireGrad = ctx.createRadialGradient(fx, fy, 4, fx, fy, width * 0.22);
      fireGrad.addColorStop(0, `rgba(255, 195, 92, ${(0.42 * flicker).toFixed(3)})`);
      fireGrad.addColorStop(0.45, `rgba(255, 122, 42, ${(0.22 * flicker).toFixed(3)})`);
      fireGrad.addColorStop(1, "rgba(255, 110, 30, 0)");
      ctx.fillStyle = fireGrad;
      ctx.beginPath();
      ctx.arc(fx, fy, width * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      for (const s of state.smoke) {
        s.life += dt * 0.26;
        if (s.life >= 1) {
          s.life = 0;
          s.x = s.source === "chimney" ? 0.724 + rand(-0.008, 0.008) : 0.702 + rand(-0.012, 0.012);
          s.y = s.source === "chimney" ? 0.25 : 0.67;
        }
        s.x += (s.vx + Math.sin(nowSec * 1.5 + s.radius) * 0.006) * dt;
        s.y += s.vy * dt;
        const alpha = Math.sin(s.life * Math.PI) * 0.18;
        const r = s.radius * (0.7 + s.life * 1.3);
        const grad = ctx.createRadialGradient(s.x * width, s.y * height, 1, s.x * width, s.y * height, r);
        grad.addColorStop(0, `rgba(255, 240, 220, ${alpha.toFixed(3)})`);
        grad.addColorStop(1, "rgba(255, 240, 220, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(s.x * width, s.y * height, r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (const p of state.sparks) {
        p.life += dt * 0.55;
        if (p.life >= 1) {
          p.life = 0;
          p.x = 0.702 + rand(-0.022, 0.022);
          p.y = 0.71 + rand(-0.015, 0.015);
        }
        p.x += (p.vx + Math.sin(nowSec * 4 + p.size) * 0.015) * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = Math.sin(p.life * Math.PI) * 0.95;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x * width, p.y * height, p.size, p.size);
      }
      ctx.restore();

      for (const l of state.flakes) {
        l.x += (l.vx + Math.sin(nowSec * 1.6 + l.phase) * 0.018) * dt;
        l.y += l.vy * dt;
        l.rot += l.vrot * dt;
        if (l.x > 1.06 || l.y > 1.06) {
          l.x = rand(-0.1, 0.85);
          l.y = -0.05;
        }
        ctx.globalAlpha = 0.8;
        drawMiniLeaf(ctx, l.x * width, l.y * height, l.size, l.rot, l.color);
      }
      ctx.globalAlpha = 1;
      break;
    }

    case "christmas": {
      drawAurora(ctx, width, height, nowSec);
      for (const s of state.smoke) {
        s.life += dt * 0.24;
        if (s.life >= 1) {
          s.life = 0;
          s.x = s.cx;
          s.y = s.cy;
        }
        s.x += (s.vx + Math.sin(nowSec + s.radius) * 0.006) * dt;
        s.y += s.vy * dt;
        const alpha = Math.sin(s.life * Math.PI) * 0.18;
        const r = s.radius * (0.65 + s.life * 1.35);
        const grad = ctx.createRadialGradient(s.x * width, s.y * height, 1, s.x * width, s.y * height, r);
        grad.addColorStop(0, `rgba(240, 246, 255, ${alpha.toFixed(3)})`);
        grad.addColorStop(1, "rgba(240, 246, 255, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(s.x * width, s.y * height, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (const t of state.twinkles) {
        const glow = 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(nowSec * t.speed + t.phase), 2);
        const px = t.x * width;
        const py = t.y * height;
        const r = t.size * (1.2 + glow * 1.4);
        const grad = ctx.createRadialGradient(px, py, 0.5, px, py, r);
        grad.addColorStop(0, t.color);
        grad.addColorStop(1, "rgba(255,255,255,0)");
        ctx.globalAlpha = glow * 0.85;
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = "#ffffff";
      for (const f of state.flakes) {
        f.x += (f.vx + Math.sin(nowSec * 1.4 + f.phase) * 0.015) * dt;
        f.y += f.vy * dt;
        if (f.y > 1.04) {
          f.y = -0.04;
          f.x = rand(0, 1);
        }
        if (f.x < -0.04) f.x = 1.04;
        if (f.x > 1.04) f.x = -0.04;
        ctx.globalAlpha = f.alpha;
        ctx.beginPath();
        ctx.arc(f.x * width, f.y * height, f.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    }

    case "newyear":
    case "springfestival": {
      drawWaterShimmer(
        ctx,
        state.ripples,
        width,
        height,
        nowSec,
        holidayId === "springfestival"
          ? "rgba(255, 204, 112, ALPHA)"
          : "rgba(182, 224, 255, ALPHA)",
      );
      state.nextFireworkAt -= dt;
      if (state.nextFireworkAt <= 0 && state.fwParticles.length < 110) {
        state.nextFireworkAt = rand(0.9, 1.8);
        const cx = rand(0.18, 0.84) * width;
        const cy = rand(0.12, 0.36) * height;
        const palette =
          holidayId === "springfestival"
            ? ["#ff5548", "#ffd870", "#ff9e4a", "#fff2ba"]
            : ["#ffe08a", "#72ccff", "#ff8da6", "#ffffff"];
        const mainColor = pick(palette);
        for (let i = 0; i < 18; i += 1) {
          const angle = (Math.PI * 2 * i) / 18 + rand(-0.15, 0.15);
          const speed = rand(48, 125);
          state.fwParticles.push({
            x: cx,
            y: cy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 0,
            maxLife: rand(0.95, 1.5),
            size: rand(2.2, 4),
            color: Math.random() < 0.7 ? mainColor : pick(palette),
          });
        }
      }
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (let i = state.fwParticles.length - 1; i >= 0; i -= 1) {
        const p = state.fwParticles[i];
        p.life += dt;
        if (p.life >= p.maxLife) {
          state.fwParticles.splice(i, 1);
          continue;
        }
        p.vy += 62 * dt;
        p.vx *= 0.985;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const fade = 1 - p.life / p.maxLife;
        ctx.globalAlpha = fade * 0.92;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
      for (const p of state.sparks) {
        p.life += dt * 0.35;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y > 1.04) p.y = -0.04;
        if (p.y < -0.04) p.y = 1.04;
        ctx.globalAlpha = 0.35 + 0.55 * Math.sin(nowSec * 3 + p.life * 6);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x * width, p.y * height, p.size, p.size);
      }
      ctx.restore();
      break;
    }

    case "halloween": {
      drawFogBank(ctx, width, height, nowSec, "rgba(154, 108, 240, 0.2)", 0.74, 0.035);
      drawFogBank(ctx, width, height, nowSec, "rgba(116, 86, 210, 0.16)", 0.54, -0.025);
      const flick = 0.72 + 0.28 * Math.sin(nowSec * 9.4) * Math.cos(nowSec * 4.7);
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (const [px, py, r] of [
        [0.3, 0.81, 0.14],
        [0.71, 0.81, 0.16],
        [0.5, 0.72, 0.12],
      ]) {
        const grad = ctx.createRadialGradient(px * width, py * height, 4, px * width, py * height, r * width);
        grad.addColorStop(0, `rgba(255, 148, 42, ${(0.34 * flick).toFixed(3)})`);
        grad.addColorStop(1, "rgba(255, 120, 20, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px * width, py * height, r * width, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const p of state.sparks) {
        p.life += dt * 0.35;
        if (p.life >= 1) {
          p.life = 0;
          p.x = rand(0.12, 0.88);
          p.y = rand(0.75, 0.98);
        }
        p.x += Math.sin(nowSec * 2 + p.size) * 0.01 * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = Math.sin(p.life * Math.PI) * 0.85;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x * width, p.y * height, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      for (const b of state.bats) {
        b.x += b.vx * dt;
        b.y += (b.vy + Math.sin(nowSec * 3.5 + b.phase) * 0.025) * dt;
        if (b.x > 1.08) b.x = -0.08;
        if (b.x < -0.08) b.x = 1.08;
        drawMiniBat(ctx, b.x * width, b.y * height, b.size, nowSec * 14 + b.phase);
      }
      break;
    }

    case "midautumn": {
      drawWaterShimmer(ctx, state.ripples, width, height, nowSec, "rgba(255, 234, 162, ALPHA)");
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const halo = 0.78 + 0.22 * Math.sin(nowSec * 1.4);
      const mg = ctx.createRadialGradient(
        width * 0.305,
        height * 0.4,
        10,
        width * 0.305,
        height * 0.4,
        width * 0.24,
      );
      mg.addColorStop(0, `rgba(255, 238, 178, ${(0.24 * halo).toFixed(3)})`);
      mg.addColorStop(1, "rgba(255, 224, 140, 0)");
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.arc(width * 0.305, height * 0.4, width * 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      for (const l of state.lanterns) {
        l.x += (l.vx + Math.sin(nowSec * 1.1 + l.phase) * 0.008) * dt;
        l.y += l.vy * dt;
        if (l.y < -0.08) {
          l.y = 0.65;
          l.x = rand(0.06, 0.74);
        }
        const px = l.x * width;
        const py = l.y * height;
        const g = ctx.createRadialGradient(px, py, 1, px, py, l.size * 2.2);
        g.addColorStop(0, "rgba(255, 244, 186, 0.85)");
        g.addColorStop(0.45, "rgba(245, 164, 62, 0.48)");
        g.addColorStop(1, "rgba(245, 130, 42, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, l.size * 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffdf88";
        ctx.fillRect(px - l.size * 0.42, py - l.size * 0.55, l.size * 0.84, l.size * 1.05);
      }
      break;
    }

    case "valentines": {
      drawGodRays(
        ctx,
        width,
        height,
        nowSec,
        "rgba(255, 198, 222, ALPHA)",
        "rgba(255, 214, 176, ALPHA)",
      );
      drawWaterShimmer(ctx, state.ripples, width, height, nowSec, "rgba(255, 218, 232, ALPHA)");
      for (const p of state.flakes) {
        p.x += (p.vx + Math.sin(nowSec * 1.6 + p.phase) * 0.02) * dt;
        p.y += p.vy * dt;
        p.rot += p.vrot * dt;
        if (p.x > 1.06 || p.y > 1.06) {
          p.x = rand(-0.1, 0.85);
          p.y = -0.05;
        }
        ctx.globalAlpha = 0.8;
        drawMiniLeaf(ctx, p.x * width, p.y * height, p.size, p.rot, p.color);
      }
      ctx.globalAlpha = 1;
      break;
    }

    case "easter": {
      drawGodRays(
        ctx,
        width,
        height,
        nowSec,
        "rgba(255, 248, 196, ALPHA)",
        "rgba(182, 255, 206, ALPHA)",
      );
      for (const b of state.butterflies) {
        b.x += (b.vx + Math.sin(nowSec * 2 + b.phase) * 0.03) * dt;
        b.y += (b.vy + Math.cos(nowSec * 2.4 + b.phase) * 0.025) * dt;
        if (b.x < 0.04 || b.x > 0.96) b.vx *= -1;
        if (b.y < 0.16 || b.y > 0.88) b.vy *= -1;
        const wing = 0.35 + 0.65 * Math.abs(Math.sin(nowSec * 11 + b.phase));
        ctx.save();
        ctx.translate(b.x * width, b.y * height);
        ctx.fillStyle = b.color;
        ctx.globalAlpha = 0.88;
        ctx.beginPath();
        ctx.ellipse(-b.size * 0.55 * wing, 0, b.size * 0.6 * wing, b.size * 0.45, -0.3, 0, Math.PI * 2);
        ctx.ellipse(b.size * 0.55 * wing, 0, b.size * 0.6 * wing, b.size * 0.45, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      break;
    }

    case "mc-anniversary": {
      drawGodRays(
        ctx,
        width,
        height,
        nowSec,
        "rgba(255, 232, 140, ALPHA)",
        "rgba(156, 255, 128, ALPHA)",
      );
      for (const s of state.smoke) {
        s.life += dt * 0.32;
        if (s.life >= 1) {
          s.life = 0;
          s.x = 0.8 + rand(-0.04, 0.04);
          s.y = 0.88;
        }
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        const alpha = Math.sin(s.life * Math.PI) * 0.22;
        const r = s.radius * (0.8 + s.life * 1.1);
        const grad = ctx.createRadialGradient(s.x * width, s.y * height, 1, s.x * width, s.y * height, r);
        grad.addColorStop(0, `rgba(220, 250, 255, ${alpha.toFixed(3)})`);
        grad.addColorStop(1, "rgba(220, 250, 255, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(s.x * width, s.y * height, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      for (const p of state.sparks) {
        p.life += dt * 0.4;
        if (p.life >= 1) {
          p.life = 0;
          p.x = rand(0.08, 0.92);
          p.y = rand(0.65, 0.98);
        }
        p.x += Math.sin(nowSec * 2 + p.size) * 0.012 * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = Math.sin(p.life * Math.PI) * 0.9;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x * width, p.y * height, p.size, p.size);
      }
      ctx.restore();
      break;
    }

    case "dragonboat": {
      drawFogBank(ctx, width, height, nowSec, "rgba(216, 255, 244, 0.2)", 0.34, 0.032);
      drawWaterShimmer(ctx, state.ripples, width, height, nowSec, "rgba(182, 255, 236, ALPHA)");
      for (const l of state.flakes) {
        l.x += (l.vx + Math.sin(nowSec * 1.5 + l.phase) * 0.015) * dt;
        l.y += l.vy * dt;
        l.rot += l.vrot * dt;
        if (l.x > 1.06 || l.y > 1.06) {
          l.x = rand(-0.1, 0.8);
          l.y = -0.05;
        }
        ctx.globalAlpha = 0.78;
        drawMiniLeaf(ctx, l.x * width, l.y * height, l.size, l.rot, l.color);
      }
      ctx.globalAlpha = 1;
      break;
    }

    default:
      break;
  }
}

export function HolidayLiveWallpaper({
  holidayId,
  imageUrl,
  active,
  isHome = true,
  appRoot,
}) {
  const canvasRef = useRef(null);
  const activeRef = useRef(active);
  const isHomeRef = useRef(isHome);
  const resumeRef = useRef(null);

  useEffect(() => {
    activeRef.current = active;
    if (active) resumeRef.current?.();
  }, [active]);

  useEffect(() => {
    isHomeRef.current = isHome;
  }, [isHome]);

  useEffect(() => {
    if (!holidayId || !imageUrl) return;
    const canvas = canvasRef.current;
    const host = appRoot?.current;
    if (!canvas || !host) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.src = imageUrl;
    let imgReady = false;
    img.onload = () => {
      imgReady = true;
    };
    if (img.complete && img.naturalWidth) imgReady = true;

    const scene = initSceneState(holidayId);
    let width = host.clientWidth || 1080;
    let height = host.clientHeight || 720;

    const resize = () => {
      width = Math.max(320, host.clientWidth || window.innerWidth);
      height = Math.max(240, host.clientHeight || window.innerHeight);
      canvas.width = width;
      canvas.height = height;
    };
    resize();

    let targetMx = 0;
    let targetMy = 0;
    let smoothMx = 0;
    let smoothMy = 0;

    const onPointerMove = (event) => {
      if (!activeRef.current) return;
      const rect = host.getBoundingClientRect();
      targetMx = ((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 2;
      targetMy = ((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 2;
    };
    const onPointerLeave = () => {
      targetMx = 0;
      targetMy = 0;
    };

    host.addEventListener("pointermove", onPointerMove, { passive: true });
    host.addEventListener("pointerleave", onPointerLeave);
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    resizeObserver?.observe(host);

    const drawSingleFrame = (now, dt) => {
      const nowSec = now / 1000;
      // Smoothly follow pointer across all tabs (full parallax on Home, softer on content tabs)
      const strength = isHomeRef.current ? 1 : 0.45;
      smoothMx += (targetMx * strength - smoothMx) * Math.min(1, dt * 4.5);
      smoothMy += (targetMy * strength - smoothMy) * Math.min(1, dt * 4.5);

      ctx.clearRect(0, 0, width, height);

      if (imgReady && img.naturalWidth) {
        const zoom = 1.08 + Math.sin(nowSec * 0.48) * 0.026;
        const swayX = Math.sin(nowSec * 0.36) * width * 0.018 - smoothMx * 18;
        const swayY = Math.cos(nowSec * 0.3) * height * 0.014 - smoothMy * 10;
        const cover =
          Math.max(width / img.naturalWidth, height / img.naturalHeight) * zoom;
        const drawW = img.naturalWidth * cover;
        const drawH = img.naturalHeight * cover;
        const drawX = (width - drawW) * 0.5 + swayX;
        const drawY = (height - drawH) * 0.5 + swayY;
        ctx.drawImage(img, drawX, drawY, drawW, drawH);
      }

      drawSceneOverlay(ctx, holidayId, scene, width, height, dt, nowSec);
    };

    let frameId = 0;
    let lastTime = performance.now();

    const drawFrame = (now) => {
      frameId = 0;
      if (document.hidden || !activeRef.current) return;
      const minInterval = isHomeRef.current ? 32 : 40;
      const elapsed = now - lastTime;

      if (elapsed >= minInterval) {
        const dt = Math.min(0.065, Math.max(0.008, elapsed / 1000));
        lastTime = now;
        drawSingleFrame(now, dt);
      }

      if (activeRef.current && !document.hidden) {
        frameId = requestAnimationFrame(drawFrame);
      }
    };

    const start = () => {
      if (!frameId && !document.hidden && activeRef.current) {
        lastTime = performance.now() - 48;
        frameId = requestAnimationFrame(drawFrame);
      }
    };
    resumeRef.current = start;
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
      resumeRef.current = null;
      if (frameId) cancelAnimationFrame(frameId);
      document.removeEventListener("visibilitychange", onVisibility);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerleave", onPointerLeave);
      resizeObserver?.disconnect();
    };
  }, [holidayId, imageUrl, appRoot]);

  return (
    <canvas
      ref={canvasRef}
      className="wallpaper holiday-live-wallpaper"
      aria-hidden="true"
    />
  );
}
