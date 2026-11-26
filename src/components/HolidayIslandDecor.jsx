/**
 * Cozy, culturally accurate per-holiday Dynamic Island (.nav) decorations
 * modeled after the Christmas snowdrift aesthetic:
 * - Sculpted organic base layer along both wings (snowdrifts, autumn foliage,
 *   auspicious clouds, starlight clouds, petal clouds, spring meadow hills,
 *   pixel grass turf, jade river waves, moonlit clouds, spooky purple mist)
 * - 8 unmistakable holiday-accurate elements nestled into the base layer
 * - Hero charms on top-left & top-right corners (ONLY Spring Festival uses
 *   hanging red lanterns!)
 * Strictly position: absolute + pointer-events: none (0px .nav geometry shift).
 */

function ChristmasDecor() {
  return (
    <>
      <svg
        className="hid-top-trim hid-trim-tall"
        viewBox="0 0 720 30"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {/* Sculpted snowdrifts */}
        <path d="M12 21 Q36 10 66 17 Q96 9 130 17 Q164 10 198 18 Q232 10 264 18 Q278 15 288 22 L288 25 L12 25 Z" fill="rgba(255,255,255,0.96)" />
        <path d="M432 22 Q454 13 488 18 Q524 10 558 18 Q592 9 626 17 Q658 10 688 17 Q699 15 708 21 L708 25 L432 25 Z" fill="rgba(255,255,255,0.96)" />

        {/* Gingerbread Man */}
        <g transform="translate(50, 7)">
          <circle cx="8" cy="5.5" r="4" fill="#c97b3e" stroke="#7d4316" strokeWidth="0.7" />
          <path d="M2 10.5 L14 10.5 M8 9.5 L8 15 M5 17.5 L8 14 L11 17.5" stroke="#c97b3e" strokeWidth="3.2" strokeLinecap="round" />
          <circle cx="6.8" cy="5" r="0.6" fill="#fff" />
          <circle cx="9.2" cy="5" r="0.6" fill="#fff" />
          <circle cx="8" cy="11.5" r="0.9" fill="#e0433e" />
          <circle cx="8" cy="14" r="0.9" fill="#3ab875" />
        </g>

        {/* Mini Christmas Tree */}
        <g transform="translate(106, 3)">
          <polygon points="9,1 2,10 16,10" fill="#2f9e64" stroke="#1b633d" strokeWidth="0.7" />
          <polygon points="9,6 0.5,16 17.5,16" fill="#3ab875" stroke="#1b633d" strokeWidth="0.7" />
          <rect x="7.5" y="16" width="3" height="3" fill="#7d4a24" />
          <circle cx="9" cy="1" r="1.9" fill="#ffe066" />
          <circle cx="6.5" cy="11" r="1.2" fill="#ff5e57" />
          <circle cx="11.5" cy="13.5" r="1.2" fill="#ffe066" />
        </g>

        {/* Red Gift Box */}
        <g transform="translate(172, 8)">
          <rect x="0" y="3" width="15" height="12" rx="1.8" fill="#e0433e" stroke="#992320" strokeWidth="0.7" />
          <rect x="6.3" y="3" width="2.4" height="12" fill="#ffd966" />
          <rect x="0" y="7.5" width="15" height="2.2" fill="#ffd966" />
          <path d="M7.5 3 C4.5 -0.5 2.5 1.5 5.5 3 M7.5 3 C10.5 -0.5 12.5 1.5 9.5 3" fill="none" stroke="#ffd966" strokeWidth="1.4" strokeLinecap="round" />
        </g>

        {/* Christmas Stocking */}
        <g transform="translate(234, 6)">
          <rect x="4" y="2" width="8.5" height="3.2" rx="1.4" fill="#fffaf5" stroke="#b0c7d9" strokeWidth="0.6" />
          <path d="M5 5 H12 V12 C12 15.5 9.5 17 6 17 C3 17 2 15.5 2 13.5 C2 11.8 3.6 11 5 11 Z" fill="#df3f3a" stroke="#961e1a" strokeWidth="0.7" />
        </g>

        {/* Mini Christmas Wreath */}
        <g transform="translate(454, 6)">
          <circle cx="9" cy="10" r="6.8" fill="none" stroke="#2f9e64" strokeWidth="3.6" />
          <circle cx="9" cy="10" r="6.8" fill="none" stroke="#4ed18a" strokeWidth="1.2" strokeDasharray="3 3" />
          <circle cx="9" cy="4" r="2" fill="#e64540" />
          <circle cx="4.5" cy="12" r="1.2" fill="#ffe066" />
          <circle cx="13.5" cy="12" r="1.2" fill="#ffe066" />
        </g>

        {/* Peeking Snowman */}
        <g transform="translate(514, 4)">
          <circle cx="10" cy="14" r="6.2" fill="#ffffff" stroke="#b0c7d9" strokeWidth="0.8" />
          <circle cx="10" cy="6.8" r="4.6" fill="#ffffff" stroke="#b0c7d9" strokeWidth="0.8" />
          <rect x="6" y="10.2" width="8" height="2.2" rx="1" fill="#e0433e" />
          <rect x="11.5" y="11" width="2.2" height="4.5" rx="0.8" fill="#e0433e" />
          <circle cx="8.3" cy="5.8" r="0.8" fill="#1e293b" />
          <circle cx="11.7" cy="5.8" r="0.8" fill="#1e293b" />
          <polygon points="10,7 14.5,7.8 10,8.5" fill="#f58220" />
        </g>

        {/* Green Gift Box */}
        <g transform="translate(580, 8)">
          <rect x="0" y="3" width="15" height="12" rx="1.8" fill="#35a36a" stroke="#1d6640" strokeWidth="0.7" />
          <rect x="6.3" y="3" width="2.4" height="12" fill="#ff665e" />
          <rect x="0" y="7.5" width="15" height="2.2" fill="#ff665e" />
          <path d="M7.5 3 C4.5 -0.5 2.5 1.5 5.5 3 M7.5 3 C10.5 -0.5 12.5 1.5 9.5 3" fill="none" stroke="#ff665e" strokeWidth="1.4" strokeLinecap="round" />
        </g>

        {/* Second Mini Pine Tree */}
        <g transform="translate(640, 4)">
          <polygon points="8,1 2,9 14,9" fill="#35a36a" stroke="#1b633d" strokeWidth="0.7" />
          <polygon points="8,5.5 0.8,15 15.2,15" fill="#43bd7d" stroke="#1b633d" strokeWidth="0.7" />
          <rect x="6.6" y="15" width="2.8" height="2.8" fill="#7d4a24" />
          <circle cx="8" cy="1" r="1.6" fill="#ffe066" />
        </g>

        {/* Warm twinkling bulbs nestled in the snow */}
        <circle className="hid-twinkle hid-d1" cx="42" cy="22" r="2.2" fill="#ff655e" />
        <circle className="hid-twinkle hid-d2" cx="92" cy="22" r="2.1" fill="#ffe066" />
        <circle className="hid-twinkle hid-d3" cx="152" cy="22" r="2.1" fill="#63e6ff" />
        <circle className="hid-twinkle hid-d1" cx="212" cy="22" r="2.2" fill="#ff655e" />
        <circle className="hid-twinkle hid-d2" cx="270" cy="22" r="2.1" fill="#6be89c" />
        <circle className="hid-twinkle hid-d2" cx="446" cy="22" r="2.1" fill="#ffe066" />
        <circle className="hid-twinkle hid-d3" cx="502" cy="22" r="2.1" fill="#63e6ff" />
        <circle className="hid-twinkle hid-d1" cx="562" cy="22" r="2.2" fill="#ff655e" />
        <circle className="hid-twinkle hid-d3" cx="622" cy="22" r="2.1" fill="#6be89c" />
        <circle className="hid-twinkle hid-d2" cx="674" cy="22" r="2.1" fill="#ffe066" />
      </svg>

      {/* Left corner: Santa hat */}
      <svg className="hid-charm hid-left hid-santa-hat" viewBox="0 0 42 32" aria-hidden="true">
        <path d="M9 23 C10 11 19 4 30 7 C33 8 35 10 36 13 C30 11 26 13 25 22 Z" fill="#df433e" stroke="#992320" strokeWidth="1" strokeLinejoin="round" />
        <path d="M13 19 C15 13 21 9 28 10" fill="none" stroke="rgba(255,224,214,0.5)" strokeWidth="1.4" strokeLinecap="round" />
        <rect x="6" y="20.5" width="22" height="6.6" rx="3.3" fill="#fffaf7" stroke="rgba(170,192,208,0.65)" strokeWidth="0.8" />
        <circle cx="36.2" cy="14.2" r="3.5" fill="#fffaf7" stroke="rgba(170,192,208,0.6)" strokeWidth="0.8" />
      </svg>

      {/* Right corner: Candy cane + holly + swaying gold bell */}
      <svg className="hid-charm hid-right hid-christmas-holly" viewBox="0 0 46 38" aria-hidden="true">
        <path d="M32 20 L32 9 C32 5 38 5 38 9" fill="none" stroke="#fff8f5" strokeWidth="3.8" strokeLinecap="round" />
        <path d="M32 20 L32 9 C32 5 38 5 38 9" fill="none" stroke="#e03c38" strokeWidth="3.8" strokeDasharray="3 3" strokeLinecap="round" />
        <path d="M18 15 C11 9 6 11 4 16 C9 17 12 19 16 18 Z" fill="#359c67" stroke="#1f6642" strokeWidth="0.9" />
        <path d="M21 15 C27 8 33 10 36 15 C31 17 27 19 22 18 Z" fill="#43b57a" stroke="#1f6642" strokeWidth="0.9" />
        <circle cx="19.5" cy="15.8" r="2.5" fill="#e84540" />
        <circle cx="16.8" cy="17.4" r="2.1" fill="#d13430" />
        <circle cx="22.1" cy="17.4" r="2.1" fill="#f05a54" />
        <g className="hid-sway-gentle" style={{ transformOrigin: "19.5px 18px" }}>
          <path d="M19.5 18 L19.5 22" stroke="#f5cf7b" strokeWidth="1.2" />
          <path d="M14.5 29 C15.2 24 17 21.5 19.5 21.5 C22 21.5 23.8 24 24.5 29 Z" fill="#f5cf7b" stroke="#b88428" strokeWidth="0.9" />
          <circle cx="19.5" cy="30.2" r="1.6" fill="#d49a35" />
        </g>
      </svg>

      {/* Bottom corners */}
      <svg className="hid-corner hid-bl" viewBox="0 0 22 22" aria-hidden="true">
        <g stroke="#d8f3ff" strokeWidth="1.4" strokeLinecap="round">
          <line x1="11" y1="3" x2="11" y2="19" />
          <line x1="3" y1="11" x2="19" y2="11" />
          <line x1="5.5" y1="5.5" x2="16.5" y2="16.5" />
          <line x1="16.5" y1="5.5" x2="5.5" y2="16.5" />
        </g>
        <circle cx="11" cy="11" r="2" fill="#ffffff" />
      </svg>
      <svg className="hid-corner hid-br" viewBox="0 0 22 22" aria-hidden="true">
        <g stroke="#d8f3ff" strokeWidth="1.4" strokeLinecap="round">
          <line x1="11" y1="3" x2="11" y2="19" />
          <line x1="3" y1="11" x2="19" y2="11" />
          <line x1="5.5" y1="5.5" x2="16.5" y2="16.5" />
          <line x1="16.5" y1="5.5" x2="5.5" y2="16.5" />
        </g>
        <circle cx="11" cy="11" r="2" fill="#ffffff" />
      </svg>
    </>
  );
}

function SpringFestivalDecor() {
  return (
    <>
      <svg
        className="hid-top-trim hid-trim-tall"
        viewBox="0 0 720 30"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="hid-sf-cloud" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffe394" />
            <stop offset="100%" stopColor="#f2b84b" />
          </linearGradient>
        </defs>
        {/* Sculpted auspicious golden-crimson cloud banks (祥云带) */}
        <path d="M12 22 Q34 11 62 17 Q92 9 124 17 Q156 10 190 17 Q226 11 260 18 Q276 15 288 22 L288 25 L12 25 Z" fill="url(#hid-sf-cloud)" opacity="0.92" />
        <path d="M16 24 Q42 16 74 20 Q108 15 144 20 Q180 15 216 20 Q250 16 284 24 Z" fill="#e04338" opacity="0.88" />
        <path d="M432 22 Q452 14 484 18 Q518 10 554 17 Q588 9 622 17 Q654 11 686 17 Q699 15 708 22 L708 25 L432 25 Z" fill="url(#hid-sf-cloud)" opacity="0.92" />
        <path d="M436 24 Q468 16 504 20 Q540 15 576 20 Q612 15 646 20 Q678 16 704 24 Z" fill="#e04338" opacity="0.88" />

        {/* Golden Ingot (金元宝) */}
        <g transform="translate(50, 8)">
          <ellipse cx="11" cy="8" rx="5.5" ry="4" fill="#ffe27a" stroke="#b87a14" strokeWidth="0.7" />
          <path d="M1 8 Q11 12.5 21 8 L18 15 Q11 17 4 15 Z" fill="#f5be42" stroke="#a6680c" strokeWidth="0.8" />
          <path d="M5 10 Q11 12.5 17 10" fill="none" stroke="#fff3b8" strokeWidth="1" />
        </g>

        {/* Red Envelope (红包) */}
        <g transform="translate(114, 6)">
          <rect x="0" y="1" width="13" height="16" rx="2" fill="#e0362d" stroke="#991a14" strokeWidth="0.8" />
          <path d="M0 5 Q6.5 9.5 13 5" fill="none" stroke="#ffd670" strokeWidth="1.1" />
          <circle cx="6.5" cy="7.5" r="2.3" fill="#ffd670" />
        </g>

        {/* Firecracker Bundle (鞭炮) */}
        <g transform="translate(172, 6)">
          <rect x="2" y="5" width="4.5" height="12" rx="1.2" transform="rotate(-14 4 11)" fill="#e83b32" stroke="#ffd670" strokeWidth="0.7" />
          <rect x="8" y="4" width="4.5" height="12" rx="1.2" fill="#e83b32" stroke="#ffd670" strokeWidth="0.7" />
          <rect x="14" y="5" width="4.5" height="12" rx="1.2" transform="rotate(14 16 11)" fill="#e83b32" stroke="#ffd670" strokeWidth="0.7" />
          <circle className="hid-twinkle hid-d1" cx="10" cy="2" r="2.2" fill="#ffe47a" />
        </g>

        {/* Tanghulu (冰糖葫芦) */}
        <g transform="translate(234, 4)">
          <line x1="10" y1="2" x2="10" y2="20" stroke="#d9a157" strokeWidth="1.5" />
          <circle cx="10" cy="5.5" r="3.4" fill="#e0342b" stroke="#941812" strokeWidth="0.6" />
          <circle cx="10" cy="11.5" r="3.4" fill="#e84338" stroke="#941812" strokeWidth="0.6" />
          <circle cx="10" cy="17.2" r="3.2" fill="#e0342b" stroke="#941812" strokeWidth="0.6" />
          <circle cx="8.8" cy="4.6" r="0.9" fill="rgba(255,255,255,0.55)" />
        </g>

        {/* Red Diamond Plaque (福字框) */}
        <g transform="translate(454, 4)">
          <rect x="3" y="3" width="14" height="14" rx="1.5" transform="rotate(45 10 10)" fill="#df3229" stroke="#ffd670" strokeWidth="1.2" />
          <path d="M7.5 8 H12.5 M10 6.5 V13.5 M7.8 11 H12.2" stroke="#ffd670" strokeWidth="1.2" strokeLinecap="round" />
        </g>

        {/* Golden Ingot */}
        <g transform="translate(514, 8)">
          <ellipse cx="11" cy="8" rx="5.5" ry="4" fill="#ffe27a" stroke="#b87a14" strokeWidth="0.7" />
          <path d="M1 8 Q11 12.5 21 8 L18 15 Q11 17 4 15 Z" fill="#f5be42" stroke="#a6680c" strokeWidth="0.8" />
          <path d="M5 10 Q11 12.5 17 10" fill="none" stroke="#fff3b8" strokeWidth="1" />
        </g>

        {/* Red Envelope */}
        <g transform="translate(578, 6)">
          <rect x="0" y="1" width="13" height="16" rx="2" fill="#e0362d" stroke="#991a14" strokeWidth="0.8" />
          <path d="M0 5 Q6.5 9.5 13 5" fill="none" stroke="#ffd670" strokeWidth="1.1" />
          <circle cx="6.5" cy="7.5" r="2.3" fill="#ffd670" />
        </g>

        {/* Firecracker Bundle */}
        <g transform="translate(636, 6)">
          <rect x="2" y="5" width="4.5" height="12" rx="1.2" transform="rotate(-14 4 11)" fill="#e83b32" stroke="#ffd670" strokeWidth="0.7" />
          <rect x="8" y="4" width="4.5" height="12" rx="1.2" fill="#e83b32" stroke="#ffd670" strokeWidth="0.7" />
          <rect x="14" y="5" width="4.5" height="12" rx="1.2" transform="rotate(14 16 11)" fill="#e83b32" stroke="#ffd670" strokeWidth="0.7" />
          <circle className="hid-twinkle hid-d2" cx="10" cy="2" r="2.2" fill="#ffe47a" />
        </g>

        {/* Gold pearl sparkles */}
        {[42, 96, 154, 214, 268, 446, 502, 560, 620, 672].map((cx, i) => (
          <circle key={cx} className={`hid-twinkle hid-d${(i % 3) + 1}`} cx={cx} cy="22" r="1.9" fill="#ffe694" />
        ))}
      </svg>

      {/* Top-left & Top-right Chinese knots */}
      <svg className="hid-charm hid-left hid-sf-knot" viewBox="0 0 32 28" aria-hidden="true">
        <rect x="10" y="9" width="12" height="12" rx="2" transform="rotate(45 16 15)" fill="#e23b32" stroke="#ffd670" strokeWidth="1.2" />
        <circle cx="16" cy="7" r="2.3" fill="none" stroke="#e23b32" strokeWidth="1.5" />
        <circle cx="8" cy="15" r="2.2" fill="none" stroke="#e23b32" strokeWidth="1.4" />
        <circle cx="24" cy="15" r="2.2" fill="none" stroke="#e23b32" strokeWidth="1.4" />
        <circle cx="16" cy="15" r="2.2" fill="#ffd670" />
      </svg>
      <svg className="hid-charm hid-right hid-sf-knot" viewBox="0 0 32 28" aria-hidden="true">
        <rect x="10" y="9" width="12" height="12" rx="2" transform="rotate(45 16 15)" fill="#e23b32" stroke="#ffd670" strokeWidth="1.2" />
        <circle cx="16" cy="7" r="2.3" fill="none" stroke="#e23b32" strokeWidth="1.5" />
        <circle cx="8" cy="15" r="2.2" fill="none" stroke="#e23b32" strokeWidth="1.4" />
        <circle cx="24" cy="15" r="2.2" fill="none" stroke="#e23b32" strokeWidth="1.4" />
        <circle cx="16" cy="15" r="2.2" fill="#ffd670" />
      </svg>

      {/* ONLY Spring Festival has hanging red palace lanterns */}
      <svg className="hid-charm hid-left-hang hid-sway-left" viewBox="0 0 28 46" aria-hidden="true">
        <line x1="14" y1="0" x2="14" y2="8" stroke="#ffd670" strokeWidth="1.6" />
        <rect x="10" y="7.5" width="8" height="2.8" rx="1" fill="#f5c252" />
        <ellipse cx="14" cy="18" rx="9.2" ry="8.8" fill="#e23b32" stroke="#a81d17" strokeWidth="0.9" />
        <ellipse cx="14" cy="18" rx="4.5" ry="8.6" fill="none" stroke="rgba(255,214,112,0.78)" strokeWidth="1" />
        <ellipse cx="11.2" cy="15" rx="2.4" ry="3.6" fill="rgba(255,235,175,0.3)" />
        <rect x="10" y="26.2" width="8" height="2.6" rx="1" fill="#f5c252" />
        <line x1="14" y1="28.8" x2="14" y2="36" stroke="#ffd670" strokeWidth="1.4" />
        <path d="M11.6 36 L14 44 L16.4 36" fill="none" stroke="#f05a4f" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <svg className="hid-charm hid-right-hang hid-sway-right" viewBox="0 0 28 46" aria-hidden="true">
        <line x1="14" y1="0" x2="14" y2="8" stroke="#ffd670" strokeWidth="1.6" />
        <rect x="10" y="7.5" width="8" height="2.8" rx="1" fill="#f5c252" />
        <ellipse cx="14" cy="18" rx="9.2" ry="8.8" fill="#e23b32" stroke="#a81d17" strokeWidth="0.9" />
        <ellipse cx="14" cy="18" rx="4.5" ry="8.6" fill="none" stroke="rgba(255,214,112,0.78)" strokeWidth="1" />
        <ellipse cx="11.2" cy="15" rx="2.4" ry="3.6" fill="rgba(255,235,175,0.3)" />
        <rect x="10" y="26.2" width="8" height="2.6" rx="1" fill="#f5c252" />
        <line x1="14" y1="28.8" x2="14" y2="36" stroke="#ffd670" strokeWidth="1.4" />
        <path d="M11.6 36 L14 44 L16.4 36" fill="none" stroke="#f05a4f" strokeWidth="1.5" strokeLinecap="round" />
      </svg>

      {/* Bottom corner gold coins */}
      <svg className="hid-corner hid-bl" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r="6.8" fill="#f5c451" stroke="#a6680c" strokeWidth="1" />
        <rect x="8.8" y="8.8" width="4.4" height="4.4" fill="#c82d2d" />
      </svg>
      <svg className="hid-corner hid-br" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r="6.8" fill="#f5c451" stroke="#a6680c" strokeWidth="1" />
        <rect x="8.8" y="8.8" width="4.4" height="4.4" fill="#c82d2d" />
      </svg>
    </>
  );
}

function NewYearDecor() {
  return (
    <>
      <svg
        className="hid-top-trim hid-trim-tall"
        viewBox="0 0 720 30"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="hid-ny-drift" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(255,232,163,0.94)" />
            <stop offset="50%" stopColor="rgba(182,226,255,0.92)" />
            <stop offset="100%" stopColor="rgba(255,232,163,0.94)" />
          </linearGradient>
        </defs>
        {/* Sculpted champagne-gold & ice-blue starlight cloud drifts */}
        <path d="M12 22 Q38 11 68 17 Q98 10 132 18 Q166 11 200 18 Q234 11 266 18 Q278 16 288 22 L288 25 L12 25 Z" fill="url(#hid-ny-drift)" />
        <path d="M432 22 Q456 14 488 18 Q524 11 558 18 Q592 10 626 17 Q658 11 688 17 Q699 15 708 22 L708 25 L432 25 Z" fill="url(#hid-ny-drift)" />

        {/* Party Hat */}
        <g transform="translate(52, 4)">
          <polygon points="9,2 1,19 17,19" fill="#5eb8eb" stroke="#286d99" strokeWidth="0.8" strokeLinejoin="round" />
          <path d="M5 10 L13 10 M3 15 L15 15" stroke="#ffe07a" strokeWidth="1.6" />
          <circle cx="9" cy="2" r="2.2" fill="#ffe07a" />
        </g>

        {/* Celebration Balloons */}
        <g transform="translate(114, 3)">
          <ellipse cx="6" cy="8" rx="5" ry="6.2" fill="#f5be42" stroke="#b37812" strokeWidth="0.7" />
          <ellipse cx="14" cy="10" rx="4.6" ry="5.8" fill="#63b7e6" stroke="#286d99" strokeWidth="0.7" />
          <path d="M6 14.5 Q7 18 9 21 M14 16 Q13 19 10 21" fill="none" stroke="#a68a4c" strokeWidth="0.9" />
          <ellipse cx="4.5" cy="6" rx="1.2" ry="2" fill="rgba(255,255,255,0.45)" />
        </g>

        {/* Champagne Flute */}
        <g transform="translate(178, 5)">
          <path d="M5 2 H13 L11.5 11 C11 13 7 13 6.5 11 Z" fill="#ffe68c" stroke="#b88414" strokeWidth="0.8" />
          <line x1="9" y1="12.5" x2="9" y2="18.5" stroke="#b88414" strokeWidth="1.3" />
          <line x1="5.5" y1="18.5" x2="12.5" y2="18.5" stroke="#b88414" strokeWidth="1.4" strokeLinecap="round" />
          <circle className="hid-twinkle hid-d1" cx="9" cy="0" r="1.4" fill="#fff7db" />
        </g>

        {/* Mini Firework Burst */}
        <g transform="translate(234, 4)">
          <g className="hid-pulse-soft" style={{ transformOrigin: "10px 10px" }}>
            <line x1="10" y1="2" x2="10" y2="6.5" stroke="#e8a620" strokeWidth="1.6" strokeLinecap="round" />
            <line x1="10" y1="13.5" x2="10" y2="18" stroke="#3c96cc" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="2" y1="10" x2="6.5" y2="10" stroke="#e86f42" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="13.5" y1="10" x2="18" y2="10" stroke="#e8a620" strokeWidth="1.6" strokeLinecap="round" />
            <line x1="4.5" y1="4.5" x2="7.5" y2="7.5" stroke="#3c96cc" strokeWidth="1.4" strokeLinecap="round" />
            <line x1="15.5" y1="4.5" x2="12.5" y2="7.5" stroke="#e86f42" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="10" cy="10" r="2" fill="#fff7db" />
          </g>
        </g>

        {/* Gold Crown */}
        <g transform="translate(456, 7)">
          <path d="M1 15 L3 5 L8 10 L12 3 L16 10 L21 5 L23 15 Z" fill="#ffd966" stroke="#b57a14" strokeWidth="0.8" strokeLinejoin="round" />
          <circle cx="12" cy="11.5" r="1.5" fill="#63b7e6" />
          <circle cx="6.5" cy="12" r="1.2" fill="#ff7866" />
          <circle cx="17.5" cy="12" r="1.2" fill="#ff7866" />
        </g>

        {/* Second Firework Burst */}
        <g transform="translate(520, 3)">
          <g className="hid-pulse-soft" style={{ transformOrigin: "11px 11px" }}>
            <line x1="11" y1="2" x2="11" y2="7" stroke="#e8a620" strokeWidth="1.6" strokeLinecap="round" />
            <line x1="11" y1="15" x2="11" y2="20" stroke="#3c96cc" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="2" y1="11" x2="7" y2="11" stroke="#e86f42" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="15" y1="11" x2="20" y2="11" stroke="#e8a620" strokeWidth="1.6" strokeLinecap="round" />
            <line x1="5" y1="5" x2="8" y2="8" stroke="#3c96cc" strokeWidth="1.4" strokeLinecap="round" />
            <line x1="17" y1="5" x2="14" y2="8" stroke="#e86f42" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="11" cy="11" r="2.2" fill="#fff7db" />
          </g>
        </g>

        {/* Coral & Gold Balloons */}
        <g transform="translate(580, 3)">
          <ellipse cx="6" cy="9" rx="4.8" ry="6" fill="#ff8f6b" stroke="#b84a28" strokeWidth="0.7" />
          <ellipse cx="14" cy="8" rx="5" ry="6.2" fill="#ffd966" stroke="#b37812" strokeWidth="0.7" />
          <path d="M6 15 Q7 18 9 21 M14 14.5 Q13 18 10 21" fill="none" stroke="#a68a4c" strokeWidth="0.9" />
        </g>

        {/* Second Party Hat */}
        <g transform="translate(638, 4)">
          <polygon points="9,2 1,19 17,19" fill="#f5be42" stroke="#a6680c" strokeWidth="0.8" strokeLinejoin="round" />
          <path d="M5 10 L13 10 M3 15 L15 15" stroke="#63b7e6" strokeWidth="1.6" />
          <circle cx="9" cy="2" r="2.2" fill="#ff7866" />
        </g>

        {/* Confetti sparkles */}
        {[42, 96, 154, 214, 268, 446, 502, 560, 620, 672].map((cx, i) => (
          <circle key={cx} className={`hid-twinkle hid-d${(i % 3) + 1}`} cx={cx} cy="22" r="2" fill={["#ff8f6b", "#ffd966", "#5eb8eb"][i % 3]} />
        ))}
      </svg>

      {/* Left corner: Party Popper + Golden Starburst */}
      <svg className="hid-charm hid-left hid-ny-stars" viewBox="0 0 44 36" aria-hidden="true">
        <polygon points="8,28 16,13 24,21" fill="#f5be42" stroke="#a6680c" strokeWidth="0.9" strokeLinejoin="round" />
        <line x1="12" y1="21" x2="19" y2="23" stroke="#e85848" strokeWidth="1.6" />
        <path className="hid-twinkle hid-d1" d="M28 4 L30 10 L36 12 L30 14 L28 20 L26 14 L20 12 L26 10 Z" fill="#ffe08a" stroke="#c99322" strokeWidth="0.7" />
        <circle cx="18" cy="7" r="2" fill="#63b7e6" />
        <circle cx="34" cy="20" r="1.8" fill="#ff8f6b" />
      </svg>

      {/* Right corner: Big firework bloom */}
      <svg className="hid-charm hid-right hid-ny-firework" viewBox="0 0 44 36" aria-hidden="true">
        <g className="hid-pulse-soft" style={{ transformOrigin: "24px 16px" }}>
          <line x1="24" y1="4" x2="24" y2="11" stroke="#ffe08a" strokeWidth="1.9" strokeLinecap="round" />
          <line x1="24" y1="21" x2="24" y2="28" stroke="#70c8ff" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="12" y1="16" x2="19" y2="16" stroke="#70c8ff" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="29" y1="16" x2="36" y2="16" stroke="#ffe08a" strokeWidth="1.9" strokeLinecap="round" />
          <line x1="15.5" y1="7.5" x2="20.5" y2="12.5" stroke="#ffb86c" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="32.5" y1="7.5" x2="27.5" y2="12.5" stroke="#ffe08a" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="15.5" y1="24.5" x2="20.5" y2="19.5" stroke="#ffe08a" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="32.5" y1="24.5" x2="27.5" y2="19.5" stroke="#70c8ff" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="24" cy="16" r="2.8" fill="#fff7db" />
        </g>
      </svg>

      {/* Bottom corner stars */}
      <svg className="hid-corner hid-bl" viewBox="0 0 22 22" aria-hidden="true">
        <path className="hid-twinkle hid-d2" d="M11 3 L12.8 9.2 L19 11 L12.8 12.8 L11 19 L9.2 12.8 L3 11 L9.2 9.2 Z" fill="#ffe08a" />
      </svg>
      <svg className="hid-corner hid-br" viewBox="0 0 22 22" aria-hidden="true">
        <path className="hid-twinkle hid-d1" d="M11 3 L12.8 9.2 L19 11 L12.8 12.8 L11 19 L9.2 12.8 L3 11 L9.2 9.2 Z" fill="#70c8ff" />
      </svg>
    </>
  );
}

function ValentinesDecor() {
  return (
    <>
      <svg
        className="hid-top-trim hid-trim-tall"
        viewBox="0 0 720 30"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="hid-val-cloud" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffe0ec" />
            <stop offset="100%" stopColor="#ffb3cf" />
          </linearGradient>
        </defs>
        {/* Fluffy blush-pink petal clouds (花瓣云) */}
        <path d="M12 22 Q36 11 66 17 Q96 10 130 17 Q164 11 198 18 Q232 10 264 18 Q278 15 288 22 L288 25 L12 25 Z" fill="url(#hid-val-cloud)" opacity="0.95" />
        <path d="M432 22 Q454 13 488 18 Q524 10 558 18 Q592 10 626 17 Q658 11 688 17 Q699 15 708 22 L708 25 L432 25 Z" fill="url(#hid-val-cloud)" opacity="0.95" />

        {/* Red Rose */}
        <g transform="translate(52, 6)">
          <path d="M5 17 C0 14 0 9 6 10 C7 13 7 15 5 17 Z" fill="#4cb572" />
          <path d="M17 17 C22 14 22 9 16 10 C15 13 15 15 17 17 Z" fill="#5ec985" />
          <circle cx="11" cy="10" r="6.5" fill="#e6457a" stroke="#9e204a" strokeWidth="0.8" />
          <path d="M8 9 C9 6 14 6 14.5 9.5 C15 12.5 10 13.5 8.5 11.5 C7.5 10 9.5 8.5 11.5 9.5" fill="none" stroke="#ffb8d0" strokeWidth="1.2" strokeLinecap="round" />
        </g>

        {/* Love Letter Envelope */}
        <g transform="translate(114, 8)">
          <rect x="0" y="2" width="19" height="13" rx="2" fill="#fff5f8" stroke="#d95b8c" strokeWidth="1" />
          <path d="M1 3 L9.5 9.5 L18 3" fill="none" stroke="#e874a0" strokeWidth="1" />
          <circle cx="9.5" cy="9" r="2.6" fill="#e8487c" />
        </g>

        {/* Chocolate Strawberry */}
        <g transform="translate(178, 6)">
          <path d="M9 5 C14 5 16 10 13 15 C11.5 17.5 6.5 17.5 5 15 C2 10 4 5 9 5 Z" fill="#eb4968" stroke="#9e1e38" strokeWidth="0.8" />
          <path d="M4.5 11 C6 13 8 10 9.5 12 C11 10 13 13 14 11 C13 15.5 11 17.5 9 17.5 C7 17.5 5 15.5 4.5 11 Z" fill="#6b3a24" />
          <path d="M6 5 L9 2 L12 5 Z" fill="#4cb572" />
        </g>

        {/* Pink Gift Box */}
        <g transform="translate(234, 8)">
          <rect x="0" y="3" width="14" height="11" rx="1.8" fill="#ff7ba9" stroke="#b53364" strokeWidth="0.7" />
          <rect x="6" y="3" width="2.2" height="11" fill="#fff0f5" />
          <rect x="0" y="7.5" width="14" height="2" fill="#fff0f5" />
        </g>

        {/* Cupid Heart & Arrow */}
        <g transform="translate(454, 5)">
          <line x1="1" y1="16" x2="23" y2="5" stroke="#f5c451" strokeWidth="1.5" strokeLinecap="round" />
          <polygon points="24,4.5 19.5,4.2 21.8,8.2" fill="#f5c451" />
          <path d="M12 18 C12 18 5.5 13.8 5.5 9.6 C5.5 7.4 7.2 5.8 9.2 5.8 C10.5 5.8 11.4 6.5 12 7.4 C12.6 6.5 13.5 5.8 14.8 5.8 C16.8 5.8 18.5 7.4 18.5 9.6 C18.5 13.8 12 18 12 18 Z" fill="#f05a8e" stroke="#a62452" strokeWidth="0.8" />
        </g>

        {/* Pink Rose */}
        <g transform="translate(518, 6)">
          <path d="M5 17 C0 14 0 9 6 10 C7 13 7 15 5 17 Z" fill="#4cb572" />
          <path d="M17 17 C22 14 22 9 16 10 C15 13 15 15 17 17 Z" fill="#5ec985" />
          <circle cx="11" cy="10" r="6.5" fill="#f578a6" stroke="#b53364" strokeWidth="0.8" />
          <path d="M8 9 C9 6 14 6 14.5 9.5 C15 12.5 10 13.5 8.5 11.5 C7.5 10 9.5 8.5 11.5 9.5" fill="none" stroke="#ffe0ec" strokeWidth="1.2" strokeLinecap="round" />
        </g>

        {/* Love Letter */}
        <g transform="translate(578, 8)">
          <rect x="0" y="2" width="19" height="13" rx="2" fill="#fff5f8" stroke="#d95b8c" strokeWidth="1" />
          <path d="M1 3 L9.5 9.5 L18 3" fill="none" stroke="#e874a0" strokeWidth="1" />
          <circle cx="9.5" cy="9" r="2.6" fill="#e8487c" />
        </g>

        {/* Diamond Ring */}
        <g transform="translate(638, 6)">
          <circle cx="9" cy="13" r="5" fill="none" stroke="#f5c451" strokeWidth="1.8" />
          <polygon points="9,3 13,7 9,10 5,7" fill="#ff8eb4" stroke="#b53364" strokeWidth="0.7" />
        </g>

        {/* Rose-pearl sparkles */}
        {[42, 96, 154, 214, 268, 446, 502, 560, 620, 672].map((cx, i) => (
          <circle key={cx} className={`hid-twinkle hid-d${(i % 3) + 1}`} cx={cx} cy="22" r="1.9" fill={i % 2 === 0 ? "#ffffff" : "#f05a8e"} />
        ))}
      </svg>

      {/* Left corner: Layered rose hearts */}
      <svg className="hid-charm hid-left hid-val-hearts" viewBox="0 0 44 34" aria-hidden="true">
        <path d="M7 26 C3 22 4 17 10 18 C11 21 11 24 7 26 Z" fill="#52b578" />
        <path className="hid-pulse-soft" style={{ transformOrigin: "17px 17px" }} d="M17 26 C17 26 7.5 20 7.5 13.6 C7.5 10.2 10 7.8 13 7.8 C14.9 7.8 16.3 8.8 17 10.2 C17.7 8.8 19.1 7.8 21 7.8 C24 7.8 26.5 10.2 26.5 13.6 C26.5 20 17 26 17 26 Z" fill="#eb6798" stroke="#ad3563" strokeWidth="0.9" />
        <path d="M31 18 C31 18 25.2 14.3 25.2 10.4 C25.2 8.4 26.7 7 28.6 7 C29.8 7 30.6 7.6 31 8.4 C31.4 7.6 32.2 7 33.4 7 C35.3 7 36.8 8.4 36.8 10.4 C36.8 14.3 31 18 31 18 Z" fill="#ffadc9" stroke="#c74b7b" strokeWidth="0.7" />
      </svg>

      {/* Right corner: Satin bow */}
      <svg className="hid-charm hid-right hid-val-bow" viewBox="0 0 44 36" aria-hidden="true">
        <path d="M21 17 C13 10 6 12 6 17 C6 22 13 22.5 21 17 Z" fill="#f27ba8" stroke="#b33d6b" strokeWidth="0.9" />
        <path d="M23 17 C31 10 38 12 38 17 C38 22 31 22.5 23 17 Z" fill="#ff9ec2" stroke="#b33d6b" strokeWidth="0.9" />
        <path d="M20.5 19 L14.5 31 L18.8 29 L21.5 20" fill="#e36495" stroke="#b33d6b" strokeWidth="0.8" />
        <path d="M23.5 19 L29.5 31 L25.2 29 L22.5 20" fill="#f27ba8" stroke="#b33d6b" strokeWidth="0.8" />
        <circle cx="22" cy="17" r="3" fill="#ffd1e1" stroke="#b33d6b" strokeWidth="0.9" />
      </svg>

      {/* Bottom corner mini hearts */}
      <svg className="hid-corner hid-bl" viewBox="0 0 22 22" aria-hidden="true">
        <path d="M11 17 C11 17 5 13.2 5 9.2 C5 7.2 6.6 5.8 8.4 5.8 C9.6 5.8 10.5 6.4 11 7.2 C11.5 6.4 12.4 5.8 13.6 5.8 C15.4 5.8 17 7.2 17 9.2 C17 13.2 11 17 11 17 Z" fill="#f58ab4" stroke="#b53b6a" strokeWidth="0.7" />
      </svg>
      <svg className="hid-corner hid-br" viewBox="0 0 22 22" aria-hidden="true">
        <path d="M11 17 C11 17 5 13.2 5 9.2 C5 7.2 6.6 5.8 8.4 5.8 C9.6 5.8 10.5 6.4 11 7.2 C11.5 6.4 12.4 5.8 13.6 5.8 C15.4 5.8 17 7.2 17 9.2 C17 13.2 11 17 11 17 Z" fill="#f58ab4" stroke="#b53b6a" strokeWidth="0.7" />
      </svg>
    </>
  );
}

function EasterDecor() {
  return (
    <>
      <svg
        className="hid-top-trim hid-trim-tall"
        viewBox="0 0 720 30"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="hid-ea-grass" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#93e89f" />
            <stop offset="100%" stopColor="#5ec474" />
          </linearGradient>
        </defs>
        {/* Rolling spring meadow hills (春日绿草丘) */}
        <path d="M12 22 Q36 11 66 17 Q96 10 130 17 Q164 11 198 18 Q232 10 264 18 Q278 15 288 22 L288 25 L12 25 Z" fill="url(#hid-ea-grass)" opacity="0.94" />
        <path d="M432 22 Q454 13 488 18 Q524 10 558 18 Q592 10 626 17 Q658 11 688 17 Q699 15 708 22 L708 25 L432 25 Z" fill="url(#hid-ea-grass)" opacity="0.94" />

        {/* Peeking Chick */}
        <g transform="translate(52, 5)">
          <circle cx="10" cy="10" r="6.5" fill="#ffe15c" stroke="#c9961a" strokeWidth="0.8" />
          <circle cx="8" cy="8.8" r="0.9" fill="#2b2118" />
          <circle cx="12" cy="8.8" r="0.9" fill="#2b2118" />
          <polygon points="10,9.8 12.2,11.2 10,12.4 7.8,11.2" fill="#f58220" />
          <path d="M3 13 L6 11 L9 14 L12 11 L15 14 L17 12 L16.5 18 Q10 20 3.5 18 Z" fill="#fffaf2" stroke="#b8a898" strokeWidth="0.7" />
        </g>

        {/* Blooming Tulips */}
        <g transform="translate(114, 5)">
          <line x1="6" y1="12" x2="6" y2="20" stroke="#368a52" strokeWidth="1.6" />
          <path d="M2 8 C2 13 10 13 10 8 L8 10 L6 6 L4 10 Z" fill="#ff8eb4" stroke="#b83b68" strokeWidth="0.6" />
          <line x1="16" y1="11" x2="16" y2="20" stroke="#368a52" strokeWidth="1.6" />
          <path d="M12 7 C12 12 20 12 20 7 L18 9 L16 5 L14 9 Z" fill="#ffe066" stroke="#b88414" strokeWidth="0.6" />
        </g>

        {/* Carrot */}
        <g transform="translate(178, 6)">
          <path d="M13 6 L16 2 M13 6 L18 5 M13 6 L14 1" stroke="#368a52" strokeWidth="1.4" strokeLinecap="round" />
          <ellipse cx="9.5" cy="11" rx="3.4" ry="6.5" transform="rotate(42 9.5 11)" fill="#f58220" stroke="#a64d0c" strokeWidth="0.8" />
        </g>

        {/* Painted Blue Egg */}
        <g transform="translate(236, 6)">
          <path d="M8 2 C11.5 2 13.5 7 13.5 11 C13.5 14.5 11 16.5 8 16.5 C5 16.5 2.5 14.5 2.5 11 C2.5 7 4.5 2 8 2 Z" fill="#8ad8ff" stroke="#2c75a8" strokeWidth="0.8" />
          <path d="M3.5 10 L6 8 L8.5 10 L11 8 L12.5 10" fill="none" stroke="#fff2a8" strokeWidth="1.4" />
        </g>

        {/* Woven Egg Basket */}
        <g transform="translate(454, 4)">
          <path d="M4 12 C4 3 18 3 18 12" fill="none" stroke="#c48a47" strokeWidth="1.5" />
          <ellipse cx="8" cy="10.5" rx="3" ry="4" fill="#c8a8ff" stroke="#7a53b8" strokeWidth="0.6" />
          <ellipse cx="14" cy="10.5" rx="3" ry="4" fill="#ffadc9" stroke="#bf5a7d" strokeWidth="0.6" />
          <path d="M2 12 H20 L18 19 H4 Z" fill="#d99f57" stroke="#8f5d24" strokeWidth="0.8" />
          <line x1="3" y1="15.5" x2="19" y2="15.5" stroke="#a67030" strokeWidth="0.9" />
        </g>

        {/* Peeking White Bunny */}
        <g transform="translate(520, 4)">
          <ellipse cx="7" cy="6" rx="2" ry="5" transform="rotate(-10 7 6)" fill="#fffaf4" stroke="#7ea390" strokeWidth="0.7" />
          <ellipse cx="13" cy="6" rx="2" ry="5" transform="rotate(10 13 6)" fill="#fffaf4" stroke="#7ea390" strokeWidth="0.7" />
          <circle cx="10" cy="14" r="5.5" fill="#fffaf4" stroke="#7ea390" strokeWidth="0.8" />
          <circle cx="8.2" cy="13.2" r="0.8" fill="#2b2118" />
          <circle cx="11.8" cy="13.2" r="0.8" fill="#2b2118" />
          <circle cx="10" cy="14.8" r="0.9" fill="#ff8eb4" />
        </g>

        {/* Painted Green Egg */}
        <g transform="translate(580, 6)">
          <path d="M8 2 C11.5 2 13.5 7 13.5 11 C13.5 14.5 11 16.5 8 16.5 C5 16.5 2.5 14.5 2.5 11 C2.5 7 4.5 2 8 2 Z" fill="#d8ff9e" stroke="#368a52" strokeWidth="0.8" />
          <path d="M3.5 9.5 H12.5" stroke="#ff8eb4" strokeWidth="1.6" />
          <circle cx="8" cy="13" r="1.3" fill="#b692eb" />
        </g>

        {/* Pastel Flower Cluster */}
        <g transform="translate(638, 7)">
          <circle cx="7" cy="9" r="3" fill="#ffadc9" />
          <circle cx="11" cy="7" r="3" fill="#ffd970" />
          <circle cx="15" cy="10" r="3" fill="#c8a8ff" />
          <circle cx="11" cy="10" r="2" fill="#fff7b8" />
        </g>

        {/* Tiny wildflowers in grass */}
        {[42, 96, 154, 214, 268, 446, 502, 560, 620, 672].map((cx, i) => (
          <circle key={cx} cx={cx} cy="22" r="2" fill={["#ffd970", "#ffadc9", "#c8a8ff", "#ffffff"][i % 4]} />
        ))}
      </svg>

      {/* Left corner: Bunny ears + flower crown */}
      <svg className="hid-charm hid-left hid-easter-ears" viewBox="0 0 42 34" aria-hidden="true">
        <g transform="rotate(-11 15 26)">
          <ellipse cx="14" cy="14" rx="4.5" ry="11.2" fill="#fffaf4" stroke="#7ea390" strokeWidth="0.9" />
          <ellipse cx="14" cy="15" rx="2.2" ry="7.2" fill="#ffb8cc" />
        </g>
        <g transform="rotate(14 27 26)">
          <ellipse cx="26" cy="15" rx="4.3" ry="10.4" fill="#fffaf4" stroke="#7ea390" strokeWidth="0.9" />
          <ellipse cx="26" cy="16" rx="2" ry="6.6" fill="#ffb8cc" />
        </g>
        <circle cx="20" cy="23" r="2.2" fill="#ffe27a" stroke="#c99c28" strokeWidth="0.6" />
        <circle cx="15" cy="24" r="1.8" fill="#ffadc9" />
        <circle cx="25" cy="24" r="1.8" fill="#c8a8ff" />
      </svg>

      {/* Right corner: Twin painted eggs + butterfly */}
      <svg className="hid-charm hid-right hid-easter-egg" viewBox="0 0 44 36" aria-hidden="true">
        <path d="M7 10 C3 6 2 11 6 13 C3 14 4 17 8 14 Z M10 10 C14 6 15 11 11 13 C14 14 13 17 9 14 Z" fill="#ffd970" stroke="#c99322" strokeWidth="0.5" />
        <path d="M16 28 C11 23 12 18 18 19 C19 22 19 26 16 28 Z" fill="#59c273" />
        <path d="M35 28 C40 23 39 18 33 19 C32 22 32 26 35 28 Z" fill="#7ad18a" />
        <path d="M31 12 C34.5 12 36.8 17.2 36.8 21.5 C36.8 25 34.4 27.5 31 27.5 C27.6 27.5 25.2 25 25.2 21.5 C25.2 17.2 27.5 12 31 12 Z" fill="#ffadc9" stroke="#bf5a7d" strokeWidth="0.8" />
        <path d="M23 9 C27.8 9 30.8 16 30.8 21.6 C30.8 26.2 27.5 29 23 29 C18.5 29 15.2 26.2 15.2 21.6 C15.2 16 18.2 9 23 9 Z" fill="#c8a8ff" stroke="#7a53b8" strokeWidth="0.9" />
        <path d="M16.2 19.2 L19.6 16.5 L23 19.2 L26.4 16.5 L29.8 19.2" fill="none" stroke="#fff2a8" strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="20" cy="23.5" r="1.4" fill="#ff9ec2" />
        <circle cx="23" cy="24.2" r="1.4" fill="#8ee8a0" />
        <circle cx="26" cy="23.5" r="1.4" fill="#ff9ec2" />
      </svg>

      {/* Bottom corner clovers */}
      <svg className="hid-corner hid-bl" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="8" cy="11" r="3" fill="#63c77c" />
        <circle cx="13" cy="11" r="3" fill="#7ad18a" />
        <circle cx="10.5" cy="7.5" r="3" fill="#8ee8a0" />
        <path d="M10.5 12 L10.5 18" stroke="#368a52" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <svg className="hid-corner hid-br" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="8" cy="11" r="3" fill="#63c77c" />
        <circle cx="13" cy="11" r="3" fill="#7ad18a" />
        <circle cx="10.5" cy="7.5" r="3" fill="#8ee8a0" />
        <path d="M10.5 12 L10.5 18" stroke="#368a52" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </>
  );
}

function McAnniversaryDecor() {
  return (
    <>
      <svg
        className="hid-top-trim hid-trim-tall"
        viewBox="0 0 720 30"
        preserveAspectRatio="none"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        {/* Stepped Minecraft grass-block turf */}
        <path d="M16 19 H286 V23 H262 V26 H232 V23 H198 V26 H166 V23 H132 V26 H96 V23 H62 V26 H34 V23 H16 Z" fill="#5ec240" />
        <path d="M434 19 H704 V23 H684 V26 H650 V23 H616 V26 H580 V23 H546 V26 H512 V23 H474 V26 H448 V23 H434 Z" fill="#5ec240" />
        <rect x="34" y="19" width="30" height="2.5" fill="#9cf272" />
        <rect x="128" y="19" width="34" height="2.5" fill="#9cf272" />
        <rect x="220" y="19" width="28" height="2.5" fill="#9cf272" />
        <rect x="464" y="19" width="32" height="2.5" fill="#9cf272" />
        <rect x="562" y="19" width="34" height="2.5" fill="#9cf272" />
        <rect x="650" y="19" width="28" height="2.5" fill="#9cf272" />

        {/* Creeper Head */}
        <g transform="translate(52, 4)">
          <rect x="0" y="0" width="16" height="15" fill="#4fbf3d" />
          <rect x="0" y="0" width="4" height="4" fill="#6ad654" />
          <rect x="12" y="2" width="4" height="4" fill="#3a9c2b" />
          <rect x="2" y="4" width="4" height="4" fill="#141a14" />
          <rect x="10" y="4" width="4" height="4" fill="#141a14" />
          <rect x="6" y="8" width="4" height="4" fill="#141a14" />
          <rect x="4" y="10" width="8" height="3" fill="#141a14" />
          <rect x="4" y="13" width="2" height="2" fill="#141a14" />
          <rect x="10" y="13" width="2" height="2" fill="#141a14" />
        </g>

        {/* Pixel Poppy */}
        <g transform="translate(118, 9)">
          <rect x="3" y="4" width="3" height="6" fill="#3a8a2e" />
          <rect x="0" y="0" width="9" height="5" fill="#e63939" />
          <rect x="3" y="2" width="3" height="2" fill="#2b1b17" />
        </g>

        {/* Pixel Diamond */}
        <g transform="translate(174, 5)">
          <polygon points="5,1 11,1 15,5 15,9 11,13 5,13 1,9 1,5" fill="#2ccce8" />
          <polygon points="5,3 11,3 13,5 13,9 11,11 5,11 3,9 3,5" fill="#6bf0ff" />
          <rect x="5" y="4" width="3" height="3" fill="#d9feff" />
        </g>

        {/* Pixel Golden Apple */}
        <g transform="translate(234, 6)">
          <rect x="6" y="0" width="2" height="3" fill="#7d4a24" />
          <rect x="3" y="3" width="9" height="9" fill="#f5c838" />
          <rect x="2" y="5" width="11" height="5" fill="#f5c838" />
          <rect x="4" y="4" width="3" height="3" fill="#fff4a8" />
        </g>

        {/* Pixel Torch */}
        <g transform="translate(458, 5)">
          <rect x="3" y="6" width="4" height="8" fill="#8f5c30" />
          <rect className="hid-twinkle hid-d1" x="2" y="2" width="6" height="4" fill="#ff9e2c" />
          <rect className="hid-twinkle hid-d2" x="3.5" y="3" width="3" height="2" fill="#fff275" />
        </g>

        {/* Pixel Chest */}
        <g transform="translate(514, 6)">
          <rect x="0" y="1" width="15" height="12" fill="#b87633" />
          <rect x="0" y="1" width="15" height="2" fill="#7d4a1a" />
          <rect x="0" y="5" width="15" height="1.5" fill="#3d240c" />
          <rect x="6" y="4" width="3" height="4" fill="#e6e6e6" />
        </g>

        {/* Pixel TNT Block */}
        <g transform="translate(578, 5)">
          <rect x="0" y="0" width="15" height="14" fill="#d9382c" />
          <rect x="0" y="4.5" width="15" height="5" fill="#f5f5f0" />
          <rect x="2" y="6" width="3" height="2" fill="#1f1f1f" />
          <rect x="6" y="6" width="3" height="2" fill="#1f1f1f" />
          <rect x="10" y="6" width="3" height="2" fill="#1f1f1f" />
          <rect x="0" y="0" width="15" height="2" fill="#a8241b" />
        </g>

        {/* Cute Pixel Slime */}
        <g transform="translate(638, 6)">
          <rect x="1" y="1" width="13" height="12" fill="#7be667" />
          <rect x="3" y="3" width="9" height="8" fill="#54c443" />
          <rect x="3.5" y="4.5" width="2.5" height="2.5" fill="#193314" />
          <rect x="9" y="4.5" width="2.5" height="2.5" fill="#193314" />
          <rect x="7" y="8" width="2" height="2" fill="#193314" />
        </g>
      </svg>

      {/* Left corner: Pixel Birthday Cake */}
      <svg className="hid-charm hid-left hid-mc-cake" viewBox="0 0 36 32" shapeRendering="crispEdges" aria-hidden="true">
        <rect className="hid-twinkle hid-d1" x="16" y="2" width="4" height="4" fill="#ffe266" />
        <rect className="hid-twinkle hid-d2" x="17" y="4" width="2" height="2" fill="#ff7a2f" />
        <rect x="16.5" y="6" width="3" height="6" fill="#ff6659" />
        <rect x="6" y="12" width="24" height="13" fill="#b87b44" />
        <rect x="6" y="12" width="24" height="5" fill="#f7f5ee" />
        <rect x="9" y="17" width="3" height="2" fill="#f7f5ee" />
        <rect x="16" y="17" width="4" height="2" fill="#f7f5ee" />
        <rect x="24" y="17" width="3" height="2" fill="#f7f5ee" />
        <rect x="9" y="13" width="3" height="2" fill="#e03b3b" />
        <rect x="22" y="13" width="3" height="2" fill="#e03b3b" />
      </svg>

      {/* Right corner: Glowing pixel emerald */}
      <svg className="hid-charm hid-right hid-mc-gem" viewBox="0 0 38 34" shapeRendering="crispEdges" aria-hidden="true">
        <g className="hid-pulse-soft" style={{ transformOrigin: "22px 17px" }}>
          <polygon points="19,6 25,6 30,11 30,22 25,27 19,27 14,22 14,11" fill="#2cb859" />
          <polygon points="19,8 25,8 28,11 28,21 25,24 19,24 16,21 16,11" fill="#52e67c" />
          <rect x="18" y="10" width="4" height="4" fill="#b8ffcb" />
          <rect x="23" y="18" width="3" height="4" fill="#1e8c42" />
        </g>
        <rect className="hid-twinkle hid-d2" x="5" y="9" width="5" height="5" fill="#a8ff3e" />
        <rect x="6" y="10" width="2" height="2" fill="#efffb8" />
      </svg>

      {/* Bottom corner pixel XP orbs */}
      <svg className="hid-corner hid-bl" viewBox="0 0 20 20" shapeRendering="crispEdges" aria-hidden="true">
        <rect x="5" y="6" width="8" height="8" fill="#52e67c" />
        <rect x="7" y="8" width="4" height="4" fill="#d8ff66" />
      </svg>
      <svg className="hid-corner hid-br" viewBox="0 0 20 20" shapeRendering="crispEdges" aria-hidden="true">
        <rect x="7" y="6" width="8" height="8" fill="#52e67c" />
        <rect x="9" y="8" width="4" height="4" fill="#d8ff66" />
      </svg>
    </>
  );
}

function DragonBoatDecor() {
  return (
    <>
      <svg
        className="hid-top-trim hid-trim-tall"
        viewBox="0 0 720 30"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="hid-db-wave" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#8ef0d0" />
            <stop offset="100%" stopColor="#46b593" />
          </linearGradient>
        </defs>
        {/* Sculpted jade river waves (碧水浪花) */}
        <path d="M12 22 Q36 12 66 18 Q96 11 130 18 Q164 12 198 18 Q232 11 264 18 Q278 16 288 22 L288 25 L12 25 Z" fill="url(#hid-db-wave)" opacity="0.92" />
        <path d="M432 22 Q454 14 488 18 Q524 11 558 18 Q592 11 626 18 Q658 12 688 18 Q699 16 708 22 L708 25 L432 25 Z" fill="url(#hid-db-wave)" opacity="0.92" />

        {/* Mini Dragon Boat */}
        <g transform="translate(52, 6)">
          <path d="M2 13 L8 18 H34 L42 10 L37 12 H10 Z" fill="#d94538" stroke="#8c1f16" strokeWidth="0.8" strokeLinejoin="round" />
          <path d="M10 14.5 H33" stroke="#ffd966" strokeWidth="1.5" />
          <path d="M39 11 C43 6 47 7 46 11 C44 12 41 12 39 11 Z" fill="#f5bd42" stroke="#99610c" strokeWidth="0.7" />
          <circle cx="43.5" cy="8.8" r="0.8" fill="#2b1712" />
          <rect x="19" y="8.5" width="6" height="4.5" rx="1" fill="#f5c451" stroke="#99610c" strokeWidth="0.6" />
        </g>

        {/* Seated Zongzi */}
        <g transform="translate(126, 6)">
          <path d="M10 2 L19 16 C19.5 17 18.7 18 17.5 18 H2.5 C1.3 18 0.5 17 1 16 Z" fill="#3da876" stroke="#1b6946" strokeWidth="0.9" />
          <path d="M5 10 H15 M3.5 13.5 H16.5" stroke="#ffe49e" strokeWidth="1.2" />
        </g>

        {/* Bamboo Leaf Sprig */}
        <g transform="translate(174, 8)">
          <path d="M14 14 C8 7 1 6 0 9 C5 13 10 15 14 14 Z" fill="#4ac295" stroke="#1d6e54" strokeWidth="0.7" />
          <path d="M14 14 C18 6 26 4 30 7 C25 12 19 15 14 14 Z" fill="#80d977" stroke="#2f7d40" strokeWidth="0.7" />
          <path d="M14 14 C11 5 14 0 18 1 C17 6 16 11 14 14 Z" fill="#63d18d" stroke="#1d6e54" strokeWidth="0.7" />
        </g>

        {/* Festive Drum */}
        <g transform="translate(234, 7)">
          <ellipse cx="9" cy="9" rx="7.5" ry="6.5" fill="#d94538" stroke="#8c1f16" strokeWidth="0.8" />
          <ellipse cx="9" cy="9" rx="4.8" ry="4.4" fill="#fff2cf" stroke="#b87a14" strokeWidth="0.8" />
          <line x1="3" y1="3" x2="15" y2="15" stroke="#c98e49" strokeWidth="1.2" />
        </g>

        {/* Second Zongzi */}
        <g transform="translate(454, 6)">
          <path d="M10 2 L19 16 C19.5 17 18.7 18 17.5 18 H2.5 C1.3 18 0.5 17 1 16 Z" fill="#3da876" stroke="#1b6946" strokeWidth="0.9" />
          <path d="M5 10 H15 M3.5 13.5 H16.5" stroke="#ff8275" strokeWidth="1.2" />
        </g>

        {/* Lotus Flower */}
        <g transform="translate(514, 6)">
          <path d="M11 3 C14 7 14 13 11 16 C8 13 8 7 11 3 Z" fill="#ff9ec2" stroke="#c44b78" strokeWidth="0.7" />
          <path d="M4 7 C8 8 11 12 11 16 C6 15 3 11 4 7 Z" fill="#ffb8d4" stroke="#c44b78" strokeWidth="0.7" />
          <path d="M18 7 C14 8 11 12 11 16 C16 15 19 11 18 7 Z" fill="#ffb8d4" stroke="#c44b78" strokeWidth="0.7" />
          <ellipse cx="11" cy="16.5" rx="9" ry="2.2" fill="#3a9c64" />
        </g>

        {/* Bamboo Sprig */}
        <g transform="translate(572, 8)">
          <path d="M14 14 C8 7 1 6 0 9 C5 13 10 15 14 14 Z" fill="#4ac295" stroke="#1d6e54" strokeWidth="0.7" />
          <path d="M14 14 C18 6 26 4 30 7 C25 12 19 15 14 14 Z" fill="#80d977" stroke="#2f7d40" strokeWidth="0.7" />
        </g>

        {/* Second Mini Dragon Boat */}
        <g transform="translate(624, 6)">
          <path d="M40 13 L34 18 H10 L2 10 L7 12 H32 Z" fill="#d94538" stroke="#8c1f16" strokeWidth="0.8" strokeLinejoin="round" />
          <path d="M10 14.5 H32" stroke="#ffe49e" strokeWidth="1.5" />
          <path d="M5 11 C1 6 -3 7 -2 11 C0 12 3 12 5 11 Z" fill="#f5bd42" stroke="#99610c" strokeWidth="0.7" />
        </g>

        {/* Water foam sparkles */}
        {[42, 108, 162, 222, 444, 502, 562, 616, 672].map((cx) => (
          <circle key={cx} cx={cx} cy="22" r="1.7" fill="rgba(255,255,255,0.88)" />
        ))}
      </svg>

      {/* Left corner: Sweeping bamboo leaf cluster */}
      <svg className="hid-charm hid-left hid-db-leaves" viewBox="0 0 44 32" aria-hidden="true">
        <path d="M6 23 C11 11 22 6 37 7 C30 16 20 21 6 23 Z" fill="#4ac295" stroke="#1d6e54" strokeWidth="0.8" />
        <path d="M8 24 C15 17 26 15 39 18 C29 23 19 25 8 24 Z" fill="#80d977" stroke="#2f7d40" strokeWidth="0.8" />
        <path d="M10 21 C18 15 26 11 33 9" fill="none" stroke="#c8ffe4" strokeWidth="0.9" />
      </svg>

      {/* Right corner: Big plump perched Zongzi (大粽子) + reed leaves */}
      <svg className="hid-charm hid-right hid-db-zongzi" viewBox="0 0 44 34" aria-hidden="true">
        <path d="M10 24 C5 18 6 12 13 13 C14 17 14 21 10 24 Z" fill="#80d977" stroke="#2f7d40" strokeWidth="0.7" />
        <path d="M34 24 C39 18 38 12 31 13 C30 17 30 21 34 24 Z" fill="#4ac295" stroke="#1d6e54" strokeWidth="0.7" />
        <path d="M22 6 L34 25 C34.8 26.4 33.8 28 32 28 H12 C10.2 28 9.2 26.4 10 25 Z" fill="#46b582" stroke="#1b6946" strokeWidth="1" strokeLinejoin="round" />
        <path d="M15 16.5 H29 M13 21.5 H31" stroke="#ffe49e" strokeWidth="1.4" />
        <circle cx="22" cy="19" r="2.2" fill="#e8685c" />
      </svg>

      {/* Bottom corner ripples */}
      <svg className="hid-corner hid-bl" viewBox="0 0 22 22" aria-hidden="true">
        <path d="M4 13 Q9 9 14 13 T20 13" fill="none" stroke="#57c29e" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <svg className="hid-corner hid-br" viewBox="0 0 22 22" aria-hidden="true">
        <path d="M2 13 Q7 9 12 13 T18 13" fill="none" stroke="#57c29e" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </>
  );
}

function MidAutumnDecor() {
  return (
    <>
      <svg
        className="hid-top-trim hid-trim-tall"
        viewBox="0 0 720 30"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="hid-ma-cloud" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(235,242,255,0.95)" />
            <stop offset="100%" stopColor="rgba(180,202,240,0.92)" />
          </linearGradient>
        </defs>
        {/* Sculpted moonlit silver-blue cloud banks (云海) */}
        <path d="M12 22 Q36 11 66 17 Q96 10 130 17 Q164 11 198 18 Q232 10 264 18 Q278 15 288 22 L288 25 L12 25 Z" fill="url(#hid-ma-cloud)" />
        <path d="M432 22 Q454 13 488 18 Q524 10 558 18 Q592 10 626 17 Q658 11 688 17 Q699 15 708 22 L708 25 L432 25 Z" fill="url(#hid-ma-cloud)" />

        {/* Embossed Mooncake (月饼) */}
        <g transform="translate(56, 6)">
          <circle cx="9" cy="10" r="8" fill="#e6a345" stroke="#995d14" strokeWidth="1" strokeDasharray="3 1.2" />
          <circle cx="9" cy="10" r="5.6" fill="#f2b857" stroke="#b5711d" strokeWidth="0.7" />
          <path d="M6.5 10 H11.5 M9 7.5 V12.5" stroke="#995d14" strokeWidth="1" strokeLinecap="round" />
        </g>

        {/* Osmanthus Branch (桂花枝) */}
        <g transform="translate(114, 8)">
          <path d="M0 14 Q10 10 22 8" fill="none" stroke="#8a6838" strokeWidth="1.3" strokeLinecap="round" />
          <circle cx="6" cy="9" r="2.2" fill="#ffe066" stroke="#c48a1a" strokeWidth="0.5" />
          <circle cx="11" cy="7" r="2.4" fill="#ffea85" stroke="#c48a1a" strokeWidth="0.5" />
          <circle cx="16" cy="10" r="2.2" fill="#ffe066" stroke="#c48a1a" strokeWidth="0.5" />
          <circle cx="20" cy="6" r="2" fill="#ffd954" stroke="#c48a1a" strokeWidth="0.5" />
        </g>

        {/* Peeking White Jade Rabbit (玉兔) */}
        <g transform="translate(178, 4)">
          <ellipse cx="7" cy="6" rx="1.8" ry="4.6" transform="rotate(-10 7 6)" fill="#fffaf0" stroke="#c9a559" strokeWidth="0.6" />
          <ellipse cx="12" cy="6" rx="1.8" ry="4.6" transform="rotate(10 12 6)" fill="#fffaf0" stroke="#c9a559" strokeWidth="0.6" />
          <circle cx="9.5" cy="14" r="5" fill="#fffaf0" stroke="#c9a559" strokeWidth="0.7" />
          <circle cx="8" cy="13.2" r="0.8" fill="#d94538" />
          <circle cx="11" cy="13.2" r="0.8" fill="#d94538" />
        </g>

        {/* Golden Starburst */}
        <g transform="translate(234, 6)">
          <path className="hid-twinkle hid-d1" d="M8 2 L9.8 7.2 L15 9 L9.8 10.8 L8 16 L6.2 10.8 L1 9 L6.2 7.2 Z" fill="#ffe082" stroke="#c98d1e" strokeWidth="0.5" />
        </g>

        {/* Second Jade Rabbit */}
        <g transform="translate(454, 4)">
          <ellipse cx="7" cy="6" rx="1.8" ry="4.6" transform="rotate(-10 7 6)" fill="#fffaf0" stroke="#c9a559" strokeWidth="0.6" />
          <ellipse cx="12" cy="6" rx="1.8" ry="4.6" transform="rotate(10 12 6)" fill="#fffaf0" stroke="#c9a559" strokeWidth="0.6" />
          <circle cx="9.5" cy="14" r="5" fill="#fffaf0" stroke="#c9a559" strokeWidth="0.7" />
          <circle cx="8" cy="13.2" r="0.8" fill="#d94538" />
          <circle cx="11" cy="13.2" r="0.8" fill="#d94538" />
        </g>

        {/* Golden Crescent & Star */}
        <g transform="translate(514, 5)">
          <path d="M12 3 C6.5 3 3 7.5 4 12.5 C5 17 10 18.5 14.5 16 C10 16 7.5 12.5 8.5 8 C9 5.5 10.5 4 12 3 Z" fill="#ffe082" stroke="#c98d1e" strokeWidth="0.7" />
        </g>

        {/* Second Embossed Mooncake */}
        <g transform="translate(578, 6)">
          <circle cx="9" cy="10" r="8" fill="#e6a345" stroke="#995d14" strokeWidth="1" strokeDasharray="3 1.2" />
          <circle cx="9" cy="10" r="5.6" fill="#f2b857" stroke="#b5711d" strokeWidth="0.7" />
          <circle cx="9" cy="10" r="2.2" fill="none" stroke="#995d14" strokeWidth="0.9" />
        </g>

        {/* Osmanthus Blossom Cluster */}
        <g transform="translate(636, 8)">
          <circle cx="5" cy="10" r="2.4" fill="#ffe066" stroke="#c48a1a" strokeWidth="0.5" />
          <circle cx="10" cy="7" r="2.6" fill="#ffea85" stroke="#c48a1a" strokeWidth="0.5" />
          <circle cx="15" cy="10" r="2.4" fill="#ffe066" stroke="#c48a1a" strokeWidth="0.5" />
        </g>

        {/* Golden osmanthus & starlight dots */}
        {[42, 96, 154, 214, 268, 446, 502, 560, 620, 672].map((cx, i) => (
          <circle key={cx} className={`hid-twinkle hid-d${(i % 3) + 1}`} cx={cx} cy="22" r="1.9" fill="#ffe082" />
        ))}
      </svg>

      {/* Left corner: Full moon + jade rabbit + cloud */}
      <svg className="hid-charm hid-left hid-ma-moon" viewBox="0 0 46 34" aria-hidden="true">
        <circle cx="17" cy="15" r="10.5" fill="rgba(255,229,158,0.24)" />
        <circle cx="17" cy="15" r="8" fill="#ffe082" stroke="#d9a13b" strokeWidth="0.8" />
        <circle cx="14.4" cy="12.6" r="1.8" fill="rgba(255,250,224,0.58)" />
        <ellipse cx="32" cy="21" rx="4.2" ry="3.4" fill="#fffaf0" stroke="#c9a559" strokeWidth="0.6" />
        <ellipse cx="30.5" cy="15" rx="1.2" ry="3.4" transform="rotate(-12 30.5 15)" fill="#fffaf0" stroke="#c9a559" strokeWidth="0.5" />
        <ellipse cx="33.5" cy="15" rx="1.2" ry="3.4" transform="rotate(10 33.5 15)" fill="#fffaf0" stroke="#c9a559" strokeWidth="0.5" />
        <path d="M12 24 C12 22 14 20.6 16.5 21 C17.6 19.3 20.2 18.8 22.3 20 C24.2 19.5 26.8 20.8 27 22.8 C28.7 23 29.4 24.8 28.2 25.8 L13.4 25.8 C12.4 25.8 12 25 12 24 Z" fill="rgba(232,240,255,0.94)" />
      </svg>

      {/* Right corner: Blooming golden osmanthus branch + mooncake (NO lantern!) */}
      <svg className="hid-charm hid-right hid-ma-osmanthus" viewBox="0 0 46 34" aria-hidden="true">
        <path d="M8 24 Q20 17 38 11" fill="none" stroke="#8a6838" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M26 15 C28 9 34 7 38 8 C35 13 31 16 26 15 Z" fill="#5da86e" stroke="#2f6e3e" strokeWidth="0.7" />
        <path d="M14 21 C11 15 13 10 18 11 C19 15 18 19 14 21 Z" fill="#4f9960" stroke="#2f6e3e" strokeWidth="0.7" />
        <circle cx="22" cy="13" r="3" fill="#ffe066" stroke="#c48a1a" strokeWidth="0.6" />
        <circle cx="27" cy="10" r="2.6" fill="#ffea85" stroke="#c48a1a" strokeWidth="0.6" />
        <circle cx="32" cy="15" r="2.8" fill="#ffd954" stroke="#c48a1a" strokeWidth="0.6" />
        <circle cx="17" cy="17" r="2.6" fill="#ffe066" stroke="#c48a1a" strokeWidth="0.6" />
        <circle cx="24" cy="21" r="6.5" fill="#e6a345" stroke="#995d14" strokeWidth="0.9" strokeDasharray="3 1.1" />
        <circle cx="24" cy="21" r="4.2" fill="#f2b857" stroke="#b5711d" strokeWidth="0.6" />
      </svg>

      {/* Bottom corner stars */}
      <svg className="hid-corner hid-bl" viewBox="0 0 22 22" aria-hidden="true">
        <path className="hid-twinkle hid-d1" d="M11 4 L12.6 9.4 L18 11 L12.6 12.6 L11 18 L9.4 12.6 L4 11 L9.4 9.4 Z" fill="#ffe59e" />
      </svg>
      <svg className="hid-corner hid-br" viewBox="0 0 22 22" aria-hidden="true">
        <path className="hid-twinkle hid-d3" d="M11 4 L12.6 9.4 L18 11 L12.6 12.6 L11 18 L9.4 12.6 L4 11 L9.4 9.4 Z" fill="#ffe59e" />
      </svg>
    </>
  );
}

function HalloweenDecor() {
  return (
    <>
      <svg
        className="hid-top-trim hid-trim-tall"
        viewBox="0 0 720 30"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="hid-hal-mist" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(186,144,242,0.92)" />
            <stop offset="100%" stopColor="rgba(128,82,194,0.9)" />
          </linearGradient>
        </defs>
        {/* Sculpted spooky twilight-purple mist banks (紫雾) */}
        <path d="M12 22 Q36 11 66 17 Q96 10 130 17 Q164 11 198 18 Q232 10 264 18 Q278 15 288 22 L288 25 L12 25 Z" fill="url(#hid-hal-mist)" />
        <path d="M432 22 Q454 13 488 18 Q524 10 558 18 Q592 10 626 17 Q658 11 688 17 Q699 15 708 22 L708 25 L432 25 Z" fill="url(#hid-hal-mist)" />

        {/* Cute Smiling White Ghost */}
        <g transform="translate(52, 3)">
          <path d="M3 19 L3 10 C3 4.5 15 4.5 15 10 L15 19 L12.5 16.8 L10 19 L7.5 16.8 L5 19 Z" fill="#faf7ff" stroke="#7d59ad" strokeWidth="0.9" strokeLinejoin="round" />
          <circle cx="7" cy="10.2" r="1.2" fill="#231630" />
          <circle cx="11" cy="10.2" r="1.2" fill="#231630" />
          <ellipse cx="9" cy="13" rx="1.4" ry="1" fill="#ff9e44" />
        </g>

        {/* Glowing Purple Potion Bottle */}
        <g transform="translate(114, 5)">
          <rect x="6" y="1" width="4" height="3" rx="0.6" fill="#c98e49" />
          <rect x="5" y="4" width="6" height="3" fill="#e6dcf7" />
          <circle cx="8" cy="13" r="6" fill="#7c3aed" stroke="#421882" strokeWidth="0.9" />
          <circle cx="6.2" cy="11.2" r="1.5" fill="#e0c4ff" />
        </g>

        {/* Mini Black Cat Head */}
        <g transform="translate(174, 6)">
          <polygon points="4,9 5,2 10,6" fill="#251833" stroke="#b688f5" strokeWidth="0.7" />
          <polygon points="16,9 15,2 10,6" fill="#251833" stroke="#b688f5" strokeWidth="0.7" />
          <circle cx="10" cy="12" r="6" fill="#251833" stroke="#b688f5" strokeWidth="0.7" />
          <circle cx="7.8" cy="11.5" r="1.3" fill="#ffe066" />
          <circle cx="12.2" cy="11.5" r="1.3" fill="#ffe066" />
        </g>

        {/* Flying Bat */}
        <path d="M234 14 Q238 8 242 12 Q246 8 250 14 Q245.5 13 242 16 Q238.5 13 234 14 Z" fill="#2d1c42" stroke="#d4b3ff" strokeWidth="0.7" />

        {/* Wrapped Halloween Candy */}
        <g transform="translate(454, 9)">
          <polygon points="0,3 5,7 0,11" fill="#ff8f33" stroke="#9e420b" strokeWidth="0.6" />
          <polygon points="22,3 17,7 22,11" fill="#ff8f33" stroke="#9e420b" strokeWidth="0.6" />
          <ellipse cx="11" cy="7" rx="6.5" ry="4.6" fill="#a864eb" stroke="#5b2b94" strokeWidth="0.8" />
          <path d="M8 3.2 L10 10.8 M12.5 3.2 L14.5 10.8" stroke="#ffe066" strokeWidth="1.4" />
        </g>

        {/* Second Little Ghost */}
        <g transform="translate(520, 4)">
          <path d="M3 18 L3 9.5 C3 4.5 14 4.5 14 9.5 L14 18 L11.5 16 L9 18 L6.5 16 L4 18 Z" fill="#faf7ff" stroke="#7d59ad" strokeWidth="0.9" strokeLinejoin="round" />
          <circle cx="6.8" cy="9.8" r="1.1" fill="#231630" />
          <circle cx="10.2" cy="9.8" r="1.1" fill="#231630" />
        </g>

        {/* Crescent Moon + Bat */}
        <g transform="translate(576, 4)">
          <path d="M12 3 C6 3 2 8 3 13 C4 18 10 20 15 17 C10 17 7 13 8 8 C8.5 5.5 10 4 12 3 Z" fill="#ffe066" stroke="#c98a14" strokeWidth="0.7" />
          <path d="M16 11 Q19 7.5 22 10 Q25 7.5 28 11 Q24.5 10.4 22 12.6 Q19.5 10.4 16 11 Z" fill="#2d1c42" stroke="#d4b3ff" strokeWidth="0.6" />
        </g>

        {/* Mini Candy Corn */}
        <g transform="translate(638, 7)">
          <polygon points="8,1 13,14 3,14" fill="#ff9e2c" stroke="#9e420b" strokeWidth="0.6" />
          <polygon points="8,1 10.2,6.5 5.8,6.5" fill="#fff7db" />
          <polygon points="11.8,11 13,14 3,14 4.2,11" fill="#f5c842" />
        </g>

        {/* Glowing pumpkin-orange & ghostly orbs in mist */}
        {[42, 96, 154, 214, 268, 446, 502, 560, 620, 672].map((cx, i) => (
          <circle key={cx} className={`hid-twinkle hid-d${(i % 3) + 1}`} cx={cx} cy="22" r="2" fill={i % 2 === 0 ? "#ff9e44" : "#ffe066"} />
        ))}
      </svg>

      {/* Left corner: Witch hat */}
      <svg className="hid-charm hid-left hid-hal-hat" viewBox="0 0 38 30" aria-hidden="true">
        <ellipse cx="19" cy="23" rx="14.5" ry="3.5" fill="#2a1940" stroke="#9e6be6" strokeWidth="0.9" />
        <path d="M11 22 L18 4 L26 22 Z" fill="#352052" stroke="#9e6be6" strokeWidth="0.9" strokeLinejoin="round" />
        <path d="M13 18.5 Q19 20.5 25 18.5" fill="none" stroke="#f28c38" strokeWidth="2.4" />
        <rect x="17.2" y="17.5" width="3.6" height="3" rx="0.5" fill="#ffd970" />
      </svg>

      {/* Right corner: Glowing Jack-o'-lantern + bat */}
      <svg className="hid-charm hid-right hid-hal-pumpkin" viewBox="0 0 44 36" aria-hidden="true">
        <path d="M6 10 Q9 6 12 8.8 Q15 6 18 10 Q14.5 9.4 12 11.6 Q9.5 9.4 6 10 Z" fill="#2d1c42" stroke="#b888f5" strokeWidth="0.65" />
        <path d="M27 12 C27.2 9 29.2 7.5 31 8" fill="none" stroke="#5ea84f" strokeWidth="2.2" strokeLinecap="round" />
        <ellipse cx="27" cy="21" rx="10.5" ry="8.4" fill="#f0822b" stroke="#9e420b" strokeWidth="0.9" />
        <ellipse cx="27" cy="21" rx="5.8" ry="8.2" fill="none" stroke="rgba(158,66,11,0.45)" strokeWidth="0.9" />
        <polygon points="22,19 24.8,17.2 25.4,19.8" fill="#ffe680" />
        <polygon points="32,19 29.2,17.2 28.6,19.8" fill="#ffe680" />
        <path d="M22 23.6 L24.2 25 L27 23.4 L29.8 25 L32 23.6" fill="none" stroke="#ffe680" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>

      {/* Bottom corners */}
      <svg className="hid-corner hid-bl" viewBox="0 0 22 22" aria-hidden="true">
        <polygon points="11,4 16,17 6,17" fill="#ff9e2c" stroke="#9e420b" strokeWidth="0.6" />
        <polygon points="11,4 13.4,10 8.6,10" fill="#fff7db" />
        <polygon points="14.8,14 16,17 6,17 7.2,14" fill="#f5c842" />
      </svg>
      <svg className="hid-corner hid-br" viewBox="0 0 22 22" aria-hidden="true">
        <polygon points="11,4 16,17 6,17" fill="#ff9e2c" stroke="#9e420b" strokeWidth="0.6" />
        <polygon points="11,4 13.4,10 8.6,10" fill="#fff7db" />
        <polygon points="14.8,14 16,17 6,17 7.2,14" fill="#f5c842" />
      </svg>
    </>
  );
}

function ThanksgivingDecor() {
  return (
    <>
      <svg
        className="hid-top-trim hid-trim-tall"
        viewBox="0 0 720 30"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="hid-tg-foliage" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#f7cc78" />
            <stop offset="100%" stopColor="#e08843" />
          </linearGradient>
        </defs>
        {/* Sculpted warm autumn foliage & harvest mounds (秋叶暖堆) */}
        <path d="M12 22 Q36 11 66 17 Q96 10 130 17 Q164 11 198 18 Q232 10 264 18 Q278 15 288 22 L288 25 L12 25 Z" fill="url(#hid-tg-foliage)" opacity="0.94" />
        <path d="M432 22 Q454 13 488 18 Q524 10 558 18 Q592 10 626 17 Q658 11 688 17 Q699 15 708 22 L708 25 L432 25 Z" fill="url(#hid-tg-foliage)" opacity="0.94" />

        {/* Pumpkin Pie Slice */}
        <g transform="translate(52, 7)">
          <path d="M2 13 L18 5 L22 14 Z" fill="#e68232" stroke="#944312" strokeWidth="0.8" strokeLinejoin="round" />
          <path d="M2 13 L22 14 L21 17 L3 16 Z" fill="#d9a157" stroke="#8a5a1e" strokeWidth="0.7" />
          <path d="M18 5 C21 5 23 11 22 14" fill="none" stroke="#c78b3e" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M10 10 C10 7.5 14 7.5 14 10 C15 10.5 14.5 12 12 12 C9.5 12 9 10.5 10 10 Z" fill="#fffaf2" stroke="#d9c6b0" strokeWidth="0.5" />
        </g>

        {/* Golden Harvest Corn Cob */}
        <g transform="translate(116, 5)">
          <ellipse cx="10" cy="11" rx="4.5" ry="7.8" transform="rotate(-18 10 11)" fill="#f7c844" stroke="#b57a12" strokeWidth="0.8" />
          <path d="M5 17 C2 12 4 8 8 11 C7 14 7 16 5 17 Z" fill="#6ca84c" stroke="#3c6e24" strokeWidth="0.6" />
          <path d="M13 18 C17 15 18 10 13 11 C13 14 13 16 13 18 Z" fill="#7fc25b" stroke="#3c6e24" strokeWidth="0.6" />
        </g>

        {/* Cute Mini Turkey */}
        <g transform="translate(172, 4)">
          <ellipse cx="5" cy="11" rx="3" ry="5.5" transform="rotate(-35 5 11)" fill="#de5635" stroke="#852812" strokeWidth="0.6" />
          <ellipse cx="10" cy="8" rx="3" ry="6" fill="#f2b84b" stroke="#9e6216" strokeWidth="0.6" />
          <ellipse cx="15" cy="11" rx="3" ry="5.5" transform="rotate(35 15 11)" fill="#e68a39" stroke="#8f4514" strokeWidth="0.6" />
          <circle cx="10" cy="15" r="5" fill="#9c5624" stroke="#592e10" strokeWidth="0.7" />
          <circle cx="10" cy="11.5" r="3" fill="#b86b32" stroke="#592e10" strokeWidth="0.6" />
          <polygon points="10,12 12,13.2 10,14 8,13.2" fill="#f7c844" />
          <circle cx="8.8" cy="10.8" r="0.7" fill="#1a110b" />
          <circle cx="11.2" cy="10.8" r="0.7" fill="#1a110b" />
        </g>

        {/* Crimson Maple Leaf */}
        <path
          transform="translate(234, 6) scale(0.95)"
          d="M11 19 L11.5 14.5 L16 15.2 L14 11.5 L18.5 8.5 L13.5 7.8 L12 3 L8.8 7.2 L4.5 6 L7.2 10 L3.5 13 L8.5 13.8 Z"
          fill="#de5635"
          stroke="#7d2912"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />

        {/* Mini Cream & Orange Pumpkins */}
        <g transform="translate(454, 6)">
          <path d="M15 7 C15.4 5 16.5 4.2 17.5 4.6" fill="none" stroke="#5d7d34" strokeWidth="1.6" strokeLinecap="round" />
          <ellipse cx="15" cy="13" rx="6.2" ry="5" fill="#fff2d6" stroke="#b8986b" strokeWidth="0.8" />
          <path d="M7 8 C7.3 6 8.3 5.2 9.2 5.6" fill="none" stroke="#5d7d34" strokeWidth="1.6" strokeLinecap="round" />
          <ellipse cx="7" cy="14" rx="6.5" ry="5.2" fill="#e88635" stroke="#8f4514" strokeWidth="0.8" />
        </g>

        {/* Pilgrim Hat */}
        <g transform="translate(514, 5)">
          <ellipse cx="10" cy="16" rx="9" ry="2.6" fill="#4a3525" stroke="#291b11" strokeWidth="0.7" />
          <rect x="4" y="5" width="12" height="11" rx="1.5" fill="#5c422e" stroke="#291b11" strokeWidth="0.7" />
          <rect x="4" y="12" width="12" height="2.6" fill="#e68a39" />
          <rect x="8.2" y="11.4" width="3.6" height="3.6" rx="0.5" fill="#ffd970" stroke="#9e6216" strokeWidth="0.6" />
        </g>

        {/* Plump Acorn + Golden Maple Leaf */}
        <g transform="translate(576, 6)">
          <path
            transform="translate(8, 0) scale(0.86)"
            d="M11 19 L11.5 14.5 L16 15.2 L14 11.5 L18.5 8.5 L13.5 7.8 L12 3 L8.8 7.2 L4.5 6 L7.2 10 L3.5 13 L8.5 13.8 Z"
            fill="#f2b84b"
            stroke="#945a12"
            strokeWidth="0.8"
            strokeLinejoin="round"
          />
          <ellipse cx="7" cy="14" rx="4.4" ry="5" fill="#cf8036" stroke="#753d12" strokeWidth="0.8" />
          <path d="M2 11 Q7 6.5 12 11 Q7 12.5 2 11 Z" fill="#7d461c" />
        </g>

        {/* Second Pumpkin Pie Slice */}
        <g transform="translate(634, 7)">
          <path d="M2 13 L18 5 L22 14 Z" fill="#e68232" stroke="#944312" strokeWidth="0.8" strokeLinejoin="round" />
          <path d="M2 13 L22 14 L21 17 L3 16 Z" fill="#d9a157" stroke="#8a5a1e" strokeWidth="0.7" />
          <path d="M10 10 C10 7.5 14 7.5 14 10 C15 10.5 14.5 12 12 12 C9.5 12 9 10.5 10 10 Z" fill="#fffaf2" stroke="#d9c6b0" strokeWidth="0.5" />
        </g>

        {/* Warm autumn berries */}
        {[42, 96, 154, 214, 268, 446, 502, 560, 620, 672].map((cx, i) => (
          <circle key={cx} cx={cx} cy="22" r="2" fill={i % 2 === 0 ? "#d94530" : "#fff0c2"} />
        ))}
      </svg>

      {/* Left corner: Lush maple cluster */}
      <svg className="hid-charm hid-left hid-tg-leaves" viewBox="0 0 48 36" aria-hidden="true">
        <path d="M29 25 L30 19.5 L36.5 20.5 L33.5 15 L40 10.5 L32.5 9.5 L31 4 L25.5 8.5 L21 6.5 L23 13 L18.5 16.5 L25 17.5 Z" fill="#f2b84b" stroke="#9e6216" strokeWidth="0.8" strokeLinejoin="round" />
        <path d="M8 25 C4 20 5 13 11 12 C13 15 15 20 12 25 Z" fill="#e68a39" stroke="#8f4514" strokeWidth="0.7" />
        <path d="M18 29 L18.6 23.2 L25 24.2 L22 19 L28.5 15 L21.5 13.8 L19.2 7.2 L14.8 12.8 L8.5 11.2 L12.4 17 L7.2 21 L14.6 22 Z" fill="#de5a35" stroke="#852812" strokeWidth="0.9" strokeLinejoin="round" />
        <line x1="18.2" y1="23.5" x2="18.8" y2="12.5" stroke="#ffd294" strokeWidth="0.9" strokeLinecap="round" />
        <circle cx="29" cy="26" r="2.3" fill="#c93b2b" />
        <circle cx="33" cy="24.5" r="2" fill="#e85a3a" />
      </svg>

      {/* Right corner: Harvest pumpkin + golden wheat stalks */}
      <svg className="hid-charm hid-right hid-tg-harvest" viewBox="0 0 50 36" aria-hidden="true">
        <path d="M16 26 Q12 15 6 7" fill="none" stroke="#c78424" strokeWidth="1.5" strokeLinecap="round" />
        <ellipse cx="11" cy="15" rx="2.7" ry="1.4" transform="rotate(-48 11 15)" fill="#f2bc52" stroke="#b5741d" strokeWidth="0.55" />
        <ellipse cx="14" cy="12.2" rx="2.7" ry="1.4" transform="rotate(-10 14 12.2)" fill="#f7ca68" stroke="#b5741d" strokeWidth="0.55" />
        <ellipse cx="8.5" cy="10.8" rx="2.5" ry="1.3" transform="rotate(-52 8.5 10.8)" fill="#f2bc52" stroke="#b5741d" strokeWidth="0.55" />
        <path d="M30 13 C30.6 9.8 32.8 8.4 34.6 9" fill="none" stroke="#6c8c3e" strokeWidth="2.2" strokeLinecap="round" />
        <ellipse cx="30" cy="22" rx="11.2" ry="8.4" fill="#e68a39" stroke="#8f4514" strokeWidth="0.9" />
        <ellipse cx="30" cy="22" rx="6.2" ry="8.2" fill="#f09b4a" stroke="#9c4e18" strokeWidth="0.8" />
        <ellipse cx="28" cy="19.5" rx="1.8" ry="3.5" fill="rgba(255,232,190,0.38)" />
        <circle cx="19" cy="26" r="2.2" fill="#cf4530" />
        <circle cx="15.8" cy="27.5" r="1.9" fill="#f2b84b" />
      </svg>

      {/* Bottom corner maple leaves */}
      <svg className="hid-corner hid-bl" viewBox="0 0 22 22" aria-hidden="true">
        <path d="M11 18 L11.4 14 L15.5 14.5 L13.5 11.2 L17.5 8.5 L13 7.8 L11.5 3.5 L8.6 7.5 L4.5 6.5 L7 10.2 L3.8 13 L8.6 13.6 Z" fill="#e0663a" stroke="#852812" strokeWidth="0.7" strokeLinejoin="round" />
      </svg>
      <svg className="hid-corner hid-br" viewBox="0 0 22 22" aria-hidden="true">
        <path d="M11 18 L11.4 14 L15.5 14.5 L13.5 11.2 L17.5 8.5 L13 7.8 L11.5 3.5 L8.6 7.5 L4.5 6.5 L7 10.2 L3.8 13 L8.6 13.6 Z" fill="#f2b84b" stroke="#9e6216" strokeWidth="0.7" strokeLinejoin="round" />
      </svg>
    </>
  );
}

const DECOR_BY_HOLIDAY = {
  christmas: ChristmasDecor,
  springfestival: SpringFestivalDecor,
  newyear: NewYearDecor,
  valentines: ValentinesDecor,
  easter: EasterDecor,
  "mc-anniversary": McAnniversaryDecor,
  dragonboat: DragonBoatDecor,
  midautumn: MidAutumnDecor,
  halloween: HalloweenDecor,
  thanksgiving: ThanksgivingDecor,
};

export function HolidayIslandDecor({ holidayId, effectsOn }) {
  const Decor = DECOR_BY_HOLIDAY[holidayId];
  if (!Decor) return null;
  return (
    <div
      className="holiday-island-decor"
      data-holiday={holidayId}
      data-animated={effectsOn ? "true" : "false"}
      aria-hidden="true"
    >
      <Decor />
    </div>
  );
}
