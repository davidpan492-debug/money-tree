"use client";

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';

/**
 * Helper function that maps a numeric health score (0.0 to 1.0)
 * across a three-point color spectrum using CSS filters:
 * - Healthy (0.5 -> 1.0): hue-rotate(-70deg -> 0deg), saturate(150% -> 100%)
 * - Moderate/Warning (0.5): hue-rotate(-70deg), saturate(150%)
 * - Unhealthy/Critical (0.0 -> 0.5): hue-rotate(-210deg -> -70deg), saturate(120% -> 150%)
 */
export const getLeafFilter = (health) => {
  const clamped = Math.max(0, Math.min(1, health));
  let hueRotate = 0;
  let saturate = 100;

  if (clamped >= 0.5) {
    // Interpolate from 0.5 (Warning) to 1.0 (Healthy)
    const t = (clamped - 0.5) / 0.5;
    hueRotate = -70 * (1 - t); // -70deg at 0.5 -> 0deg at 1.0
    saturate = 150 - 50 * t;   // 150% at 0.5 -> 100% at 1.0
  } else {
    // Interpolate from 0.0 (Critical) to 0.5 (Warning)
    const t = clamped / 0.5;
    hueRotate = -210 + 140 * t; // -210deg at 0.0 -> -70deg at 0.5
    saturate = 120 + 30 * t;    // 120% at 0.0 -> 150% at 0.5
  }

  return `hue-rotate(${hueRotate.toFixed(1)}deg) saturate(${saturate.toFixed(1)}%)`;
};

/**
 * Darkens and desaturates the wood (branches, trunk, and roots) based on health,
 * keeping it in a natural brown spectrum without weird hue shifts.
 */
export const getWoodFilter = (health) => {
  const clamped = Math.max(0, Math.min(1, health));
  let brightness = 100;
  let saturate = 100;

  if (clamped >= 0.5) {
    // Interpolate from 0.5 to 1.0
    const t = (clamped - 0.5) / 0.5;
    brightness = 85 + 15 * t; // 85% at 0.5 -> 100% at 1.0
    saturate = 90 + 10 * t;   // 90% at 0.5 -> 100% at 1.0
  } else {
    // Interpolate from 0.0 (Dead/Barren) to 0.5 (Warning)
    const t = clamped / 0.5;
    brightness = 55 + 30 * t; // 55% at 0.0 -> 85% at 0.5
    saturate = 40 + 50 * t;   // 40% at 0.0 -> 90% at 0.5
  }

  return `brightness(${brightness.toFixed(1)}%) saturate(${saturate.toFixed(1)}%)`;
};

/**
 * Deterministically assigns each leaf in a branch a shedding threshold below 0.60
 * so that:
 * - At health >= 0.60: 100% of leaves are full size & visible
 * - Between 0.60 and 0.00: leaves progressively shrink, droop slightly, and fade out
 * - At health == 0.00: 0 leaves remain visible
 * - Moving the slider back up smoothly regrows the leaves
 */
const getLeafSheddingState = (index, totalLeaves, health) => {
  if (health >= 0.6) {
    return { scale: 1, opacity: 1, isVisible: true };
  }
  if (health <= 0.005) {
    return { scale: 0, opacity: 0, isVisible: false };
  }

  // Spread leaf disappearance thresholds across [0.04, 0.56] in a natural pseudo-random order
  const goldenOrder = ((index * 7 + 3) % totalLeaves) / Math.max(1, totalLeaves - 1);
  const threshold = 0.04 + goldenOrder * 0.50; // each leaf starts disappearing around threshold + 0.06

  // Binary state: either it's fully present or fully gone based on the threshold.
  // This prevents floating/partial states when the slider stops midway.
  const isVisible = health > threshold;

  return {
    scale: isVisible ? 1 : 0,
    opacity: isVisible ? 1 : 0,
    isVisible
  };
};

/**
 * Component that wraps a branch's <motion.g> leaf cluster, automatically groups every
 * 3 consecutive <path> facets into a single geometric leaf unit, and animates each leaf's
 * scale, opacity, and slight downward droop when health drops below 0.60.
 */
const AnimatedLeafCluster = ({ id, health, children }) => {
  // Group every 3 consecutive path facets into 1 complete geometric leaf
  const leafGroups = useMemo(() => {
    const childArray = React.Children.toArray(children);
    const groups = [];
    for (let i = 0; i < childArray.length; i += 3) {
      groups.push(childArray.slice(i, i + 3));
    }
    return groups;
  }, [children]);

  const filterString = getLeafFilter(health);

  return (
    <motion.g
      id={id}
      initial={false}
      animate={{ filter: filterString }}
      transition={{ duration: 0.45, ease: 'easeOut' }}
    >
      {leafGroups.map((paths, idx) => {
        const { scale, opacity } = getLeafSheddingState(
          idx,
          leafGroups.length,
          health
        );

        return (
          <motion.g
            key={`${id}-leaf-${idx}`}
            initial={false}
            animate={{
              scale,
              opacity
            }}
            transition={{
              type: 'spring',
              stiffness: 300,
              damping: 25,
              mass: 0.5
            }}
            style={{
              transformBox: 'fill-box',
              transformOrigin: 'center'
            }}
          >
            {paths}
          </motion.g>
        );
      })}
    </motion.g>
  );
};


/**
 * @param {{income,savings,investments,spending,auto,debt,roots,trunk}} scores  0..1 each
 * @param {string|null} selected  branch key currently highlighted
 * @param {(key:string)=>void} onSelect
 */
const ANCHORS = {
  income: [473, 382], savings: [700, 250], investments: [952, 272], spending: [1159, 445],
  auto: [1212, 703], debt: [453, 671], trunk: [800, 980], roots: [800, 1180]
};

// Floating "+N pts" chips and a pulsing ring over every part a preview changes.
function DeltaOverlay({ deltas, pulse }) {
  if (!deltas) return null;
  return (
    <g id="delta-overlay" style={{ pointerEvents: 'none' }}>
      {Object.entries(ANCHORS).map(([key, [x, y]]) => {
        const d = Math.round((deltas[key] || 0) * 100);
        const hot = pulse === key;
        if (d === 0 && !hot) return null;
        const up = d > 0, flat = d === 0;
        const color = flat ? '#78716c' : up ? '#047857' : '#be123c';
        const label = flat ? '±0 pts' : `${up ? '+' : '−'}${Math.abs(d)} pts`;
        return (
          <g key={key} data-testid={`delta-${key}`}>
            {hot && (
              <motion.circle cx={x} cy={y} r={110} fill={color} fillOpacity={0.12} stroke={color} strokeWidth={4}
                initial={{ opacity: 0.2 }} animate={{ opacity: [0.2, 0.9, 0.2] }} transition={{ duration: 1.6, repeat: Infinity }} />
            )}
            <rect x={x - 70} y={y - 26} width={140} height={52} rx={26} fill="#fff" stroke={color} strokeWidth={4} />
            <text x={x} y={y + 9} textAnchor="middle" fontSize={28} fontWeight={700} fill={color} fontFamily="ui-monospace, monospace">{label}</text>
          </g>
        );
      })}
    </g>
  );
}

export default function TreeCanvas({ scores, selected, onSelect, deltas = null, pulse = null }) {
  // Everything except the selected part fades to 55% (null selection = nothing faded).
  const dim = (key) => (selected && selected !== key ? 0.55 : 1);
  return (
    <svg
              viewBox="0 0 1600 1400"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="w-full h-full max-h-[75vh] select-none"
            >
              <rect width="1600" height="1400" fill="#F3EFE6" />
              <g id="Frame" clipPath="url(#clip0_0_1)">
                <g id="background">
                  <path id="Vector" d="M10 3H1610V1403H10V3Z" fill="#F3EFE6" />
                </g>

                {/* Branch Income */}
                <g
                  id="branch-income" onClick={() => onSelect('income')}
                  className="transition-opacity duration-300 cursor-pointer"
                  style={{
                    opacity: selected && selected !== 'income' ? 0.55 : 1
                  }}
                >
                  <motion.g
                    id="wood-income"
                    animate={{ filter: getWoodFilter(scores.income) }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                  >
                    <path id="Vector_2" d="M791 823L720 705L631 628L546 543L438 490L368 418L323 355L376 409L455 468L561 513L658 595L750 650L826 738L791 823Z" fill="#A78F70" />
                    <path id="Vector_3" d="M791 823L720 705L631 628L546 543L438 490L368 418L455 478L558 528L647 606L750 674L791 823Z" fill="#C4AC87" />
                    <path id="Vector_4" d="M438 490L423 411L435 329L445 288L440 378L444 454L487 490H438Z" fill="#8D7962" />
                    <path id="Vector_5" d="M555 538L550 455L517 383L496 319L525 376L568 451L578 558L555 538Z" fill="#B6A080" />
                    <path id="Vector_6" d="M634 625L604 525L627 454L636 407L635 477L621 526L653 605L634 625Z" fill="#B6A080" />
                    <path id="Twig_01" d="M375 423L318 427L271 402" strokeWidth="6" stroke="#9B856B" />
                    <path id="Twig_02" d="M423 410L383 359L374 307" strokeWidth="6" stroke="#9B856B" />
                    <path id="Twig_03" d="M550 453L597 391L598 350" strokeWidth="6" stroke="#9B856B" />
                    <path id="Fine_twig_01" d="M318 427L300 466" strokeWidth="4" strokeLinejoin="bevel" stroke="#B6A080" />
                    <path id="Fine_twig_02" d="M383 359L337 340" strokeWidth="4" strokeLinejoin="bevel" stroke="#B6A080" />
                    <path id="Fine_twig_03" d="M439 367L475 349" strokeWidth="4" strokeLinejoin="bevel" stroke="#B6A080" />
                    <path id="Fine_twig_04" d="M518 384L475 405" strokeWidth="4" strokeLinejoin="bevel" stroke="#B6A080" />
                  </motion.g>
                  <AnimatedLeafCluster id="leaves-income" health={scores.income}>
                    <path id="Vector_7" d="M322 423L268.84 437.899L222.966 399.327L274.863 376.221L306.45 391.656L322 423Z" fill="#B9D6BE" />
                    <path id="Vector_8" d="M322 423L222.966 399.327L274.863 376.221L306.45 391.656L322 423Z" fill="#8FB5A0" />
                    <path id="Vector_9" d="M268.84 437.899L222.966 399.327L270.006 411.868L268.84 437.899Z" fill="#D4E5CD" />
                    <path id="Vector_10" d="M301 466L277.66 495.734L228.469 490.652L254.72 452.312L281.018 453.092L301 466Z" fill="#A9BE9E" />
                    <path id="Vector_11" d="M301 466L228.469 490.652L254.72 452.312L281.018 453.092L301 466Z" fill="#7F9E87" />
                    <path id="Vector_12" d="M277.66 495.734L228.469 490.652L262.706 478.87L277.66 495.734Z" fill="#C6D6B5" />
                    <path id="Vector_13" d="M337 340L294.617 327.89L269.511 276.864L323.011 298.985L337 340Z" fill="#C2DCC8" />
                    <path id="Vector_14" d="M337 340L269.511 276.864L323.011 298.985L337 340Z" fill="#91B5A0" />
                    <path id="Vector_15" d="M294.617 327.89L269.511 276.864L301.162 310.1L294.617 327.89Z" fill="#DCE9D4" />
                    <path id="Vector_16" d="M376 352L328.089 320.475L327.065 258.221L380.551 283.162L389.977 318.446L376 352Z" fill="#B9D6BE" />
                    <path id="Vector_17" d="M376 352L327.065 258.221L380.551 283.162L389.977 318.446L376 352Z" fill="#8FB5A0" />
                    <path id="Vector_18" d="M328.089 320.475L327.065 258.221L349.292 303.649L328.089 320.475Z" fill="#D4E5CD" />
                    <path id="Vector_19" d="M376 412L336.806 420.238L300.341 382.612L347.76 369.371L368.573 387.915L376 412Z" fill="#A9BE9E" />
                    <path id="Vector_20" d="M376 412L300.341 382.612L347.76 369.371L368.573 387.915L376 412Z" fill="#7F9E87" />
                    <path id="Vector_21" d="M336.806 420.238L300.341 382.612L336.154 396.366L336.806 420.238Z" fill="#C6D6B5" />
                    <path id="Vector_22" d="M438 327L411.877 277.15L440.615 223.232L474.655 270.083L465.959 304.851L438 327Z" fill="#B9D6BE" />
                    <path id="Vector_23" d="M438 327L440.615 223.232L474.655 270.083L465.959 304.851L438 327Z" fill="#8FB5A0" />
                    <path id="Vector_24" d="M411.877 277.15L440.615 223.232L438.08 272.795L411.877 277.15Z" fill="#D4E5CD" />
                    <path id="Vector_25" d="M445 288L407.37 259.699L401.866 199.204L446.751 241.743L445 288Z" fill="#C2DCC8" />
                    <path id="Vector_26" d="M445 288L401.866 199.204L446.751 241.744L445 288Z" fill="#91B5A0" />
                    <path id="Vector_27" d="M407.37 259.699L401.866 199.204L420.707 244.464L407.37 259.699Z" fill="#DCE9D4" />
                    <path id="Vector_28" d="M475 349L478.782 306.869L528.046 281.657L526.777 333.64L501.62 348.936L475 349Z" fill="#A9BE9E" />
                    <path id="Vector_29" d="M475 349L528.046 281.657L526.777 333.64L501.62 348.936L475 349Z" fill="#7F9E87" />
                    <path id="Vector_30" d="M478.782 306.869L528.046 281.657L503.096 313.582L478.782 306.869Z" fill="#C6D6B5" />
                    <path id="Vector_31" d="M423 408L431.434 365.957L474.304 347.811L471.994 391.874L450.175 408.291L423 408Z" fill="#B9D6BE" />
                    <path id="Vector_32" d="M423 408L474.304 347.811L471.994 391.874L450.175 408.291L423 408Z" fill="#8FB5A0" />
                    <path id="Vector_33" d="M431.434 365.957L474.304 347.811L449.038 375.943L431.434 365.957Z" fill="#D4E5CD" />
                    <path id="Vector_34" d="M443.62 477.6L414.1 499.74L369 482.52L403.44 453L428.04 460.38L443.62 477.6Z" fill="#A9BE9E" />
                    <path id="Vector_35" d="M443.626 476.754L369.006 481.674L403.446 452.154L428.046 459.534L443.626 476.754Z" fill="#7F9E87" />
                    <path id="Vector_36" d="M416 500L389.41 493.721L369 482L402.539 482L416 500Z" fill="#C6D6B5" />
                    <path id="Vector_37" d="M475 405L438.01 381.027L428.919 324.891L473.614 361.687L475 405Z" fill="#C2DCC8" />
                    <path id="Vector_38" d="M475 405L428.919 324.891L473.614 361.687L475 405Z" fill="#91B5A0" />
                    <path id="Vector_39" d="M438.01 381.027L428.919 324.891L449.47 365.928L438.01 381.027Z" fill="#DCE9D4" />
                    <path id="Vector_40" d="M517 384L495.981 338.209L524.2 291.352L552.437 334.833L543.033 365.509L517 384Z" fill="#B9D6BE" />
                    <path id="Vector_41" d="M517 384L524.2 291.352L552.437 334.833L543.033 365.509L517 384Z" fill="#8FB5A0" />
                    <path id="Vector_42" d="M495.981 338.209L524.2 291.352L519.611 335.544L495.981 338.209Z" fill="#D4E5CD" />
                    <path id="Vector_43" d="M496 322L467.577 294.427L478.258 243.732L515.33 275.281L511.637 302.595L496 322Z" fill="#A9BE9E" />
                    <path id="Vector_44" d="M496 322L478.258 243.732L515.33 275.281L511.637 302.595L496 322Z" fill="#7F9E87" />
                    <path id="Vector_45" d="M467.577 294.427L478.258 243.732L486.785 280.693L467.577 294.427Z" fill="#C6D6B5" />
                    <path id="Vector_46" d="M551 454L566.269 410.506L614.62 397.603L605.569 444.164L579.885 458.376L551 454Z" fill="#B9D6BE" />
                    <path id="Vector_47" d="M551 454L614.62 397.603L605.569 444.164L579.885 458.376L551 454Z" fill="#8FB5A0" />
                    <path id="Vector_48" d="M566.269 410.506L614.62 397.603L583.514 423.77L566.269 410.506Z" fill="#D4E5CD" />
                    <path id="Vector_49" d="M598 355L599.276 317.454L636.295 286.172L629.034 334.975L598 355Z" fill="#C2DCC8" />
                    <path id="Vector_50" d="M598 355L636.295 286.172L629.034 334.975L598 355Z" fill="#91B5A0" />
                    <path id="Vector_51" d="M599.276 317.454L636.295 286.172L615.337 319.199L599.276 317.454Z" fill="#DCE9D4" />
                    <path id="Vector_52" d="M597 392L613.416 359.961L660.328 355.772L642.754 396.387L618.026 400.436L597 392Z" fill="#A9BE9E" />
                    <path id="Vector_53" d="M597 392L660.328 355.772L642.754 396.387L618.026 400.436L597 392Z" fill="#7F9E87" />
                    <path id="Vector_54" d="M613.416 359.961L660.328 355.772L630.462 373.009L613.416 359.961Z" fill="#C6D6B5" />
                    <path id="Vector_55" d="M558 525L518.429 541.517L479.413 516.124L517.234 493.399L543.045 502.308L558 525Z" fill="#B9D6BE" />
                    <path id="Vector_56" d="M558 525L479.413 516.124L517.234 493.399L543.045 502.308L558 525Z" fill="#8FB5A0" />
                    <path id="Vector_57" d="M518.429 541.517L479.413 516.124L516.864 521.34L518.429 541.517Z" fill="#D4E5CD" />
                    <path id="Vector_58" d="M627 476L614.152 440.45L644.529 401.426L663.133 444.006L648.535 465.895L627 476Z" fill="#A9BE9E" />
                    <path id="Vector_59" d="M627 476L644.529 401.427L663.133 444.006L648.535 465.895L627 476Z" fill="#7F9E87" />
                    <path id="Vector_60" d="M614.152 440.45L644.529 401.426L636.379 436.705L614.152 440.45Z" fill="#C6D6B5" />
                    <path id="Vector_61" d="M615 525L584.468 508.803L573.531 465.576L610.958 491.263L615 525Z" fill="#C2DCC8" />
                    <path id="Vector_62" d="M615 525L573.531 465.576L610.958 491.263L615 525Z" fill="#91B5A0" />
                    <path id="Vector_63" d="M584.468 508.803L573.531 465.576L592.388 496.225L584.468 508.803Z" fill="#DCE9D4" />
                  </AnimatedLeafCluster>
                </g>

                {/* Branch Savings */}
                <g
                  id="branch-savings" onClick={() => onSelect('savings')}
                  className="transition-opacity duration-300 cursor-pointer"
                  style={{
                    opacity: selected && selected !== 'savings' ? 0.55 : 1
                  }}
                >
                  <motion.g
                    id="wood-savings"
                    animate={{ filter: getWoodFilter(scores.savings) }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                  >
                    <path id="Vector_64" d="M775 730.5L714 555L696 446L645 340L643 255L669 183L652 267L661 331L721 432L746 542L820 683L775 730.5Z" fill="#A78F70" />
                    <path id="Vector_65" d="M762 694L714 555L696 446L645 340L643 255L656 332L709 438L732 549L790 673L762 694Z" fill="#C4AC87" />
                    <path id="Vector_66" d="M703 458L744 381L757 294L803 226L769 305L762 387L724 474L703 458Z" fill="#A78F70" />
                    <path id="Vector_67" d="M655 351L598 309L558 237L604 297L658 328L655 351Z" fill="#B6A080" />
                    <path id="Twig_04" d="M646 284L604 252L596 201" strokeWidth="6" stroke="#9B856B" />
                    <path id="Twig_05" d="M758 329L713 282L708 237" strokeWidth="6" stroke="#9B856B" />
                    <path id="Fine_twig_05" d="M604 252L560 269" strokeWidth="4" strokeLinejoin="bevel" stroke="#B6A080" />
                    <path id="Fine_twig_06" d="M713 282L732 215" strokeWidth="4" strokeLinejoin="bevel" stroke="#B6A080" />
                    <path id="Fine_twig_07" d="M769 304L810 310" strokeWidth="4" strokeLinejoin="bevel" stroke="#B6A080" />
                  </motion.g>
                  <AnimatedLeafCluster id="leaves-savings" health={scores.savings}>
                    <path id="Vector_68" d="M560 270L525.372 279.844L490.315 248.392L532.004 233.546L551.83 248.869L560 270Z" fill="#A9BE9E" />
                    <path id="Vector_69" d="M560 270L490.315 248.392L532.004 233.546L551.83 248.869L560 270Z" fill="#7F9E87" />
                    <path id="Vector_70" d="M525.372 279.844L490.315 248.392L523.29 258.479L525.372 279.844Z" fill="#C6D6B5" />
                    <path id="Vector_71" d="M593 248L544.522 242.61L519.71 195.831L569.87 194.08L590.636 217.177L593 248Z" fill="#B9D6BE" />
                    <path id="Vector_72" d="M593 248L519.71 195.831L569.87 194.08L590.636 217.177L593 248Z" fill="#8FB5A0" />
                    <path id="Vector_73" d="M544.522 242.61L519.71 195.831L554.093 221.673L544.522 242.61Z" fill="#D4E5CD" />
                    <path id="Vector_74" d="M597 202L573.331 172.827L580.747 124.931L607.284 166.527L597 202Z" fill="#C2DCC8" />
                    <path id="Vector_75" d="M597 202L580.747 124.931L607.284 166.527L597 202Z" fill="#91B5A0" />
                    <path id="Vector_76" d="M573.331 172.827L580.747 124.931L586.597 163.606L573.331 172.827Z" fill="#DCE9D4" />
                    <path id="Vector_77" d="M646 260L630.33 207.622L667.728 161.533L691.503 212.52L676.767 244.062L646 260Z" fill="#B9D6BE" />
                    <path id="Vector_78" d="M646 260L667.728 161.533L691.503 212.52L676.767 244.062L646 260Z" fill="#8FB5A0" />
                    <path id="Vector_79" d="M630.33 207.622L667.728 161.533L656.124 208.326L630.33 207.622Z" fill="#D4E5CD" />
                    <path id="Vector_80" d="M670 187L644.303 163.756L652.095 119.099L685.476 145.556L683.081 169.553L670 187Z" fill="#A9BE9E" />
                    <path id="Vector_81" d="M670 187L652.095 119.099L685.476 145.556L683.081 169.553L670 187Z" fill="#7F9E87" />
                    <path id="Vector_82" d="M644.303 163.756L652.095 119.099L660.68 151.16L644.303 163.756Z" fill="#C6D6B5" />
                    <path id="Vector_83" d="M653 332L609.806 340.127L576.1 306.354L618.862 291.629L642.842 306.062L653 332Z" fill="#B9D6BE" />
                    <path id="Vector_84" d="M653 332L576.1 306.354L618.862 291.629L642.842 306.062L653 332Z" fill="#8FB5A0" />
                    <path id="Vector_85" d="M609.806 340.127L576.1 306.354L612.537 319.563L609.806 340.127Z" fill="#D4E5CD" />
                    <path id="Vector_86" d="M708 239L673.168 206.579L674.027 145.194L714.646 192.692L708 239Z" fill="#C2DCC8" />
                    <path id="Vector_87" d="M708 239L674.027 145.194L714.646 192.692L708 239Z" fill="#91B5A0" />
                    <path id="Vector_88" d="M673.168 206.579L674.027 145.194L688.182 192.675L673.168 206.579Z" fill="#DCE9D4" />
                    <path id="Vector_89" d="M732 217L716.134 172.58L746.274 131.184L769.06 174.038L757.788 201.879L732 217Z" fill="#B9D6BE" />
                    <path id="Vector_90" d="M732 217L746.274 131.184L769.06 174.038L757.788 201.879L732 217Z" fill="#8FB5A0" />
                    <path id="Vector_91" d="M716.134 172.58L746.274 131.184L738.389 172.023L716.134 172.58Z" fill="#D4E5CD" />
                    <path id="Vector_92" d="M715 285L724.279 250.682L768.732 237.005L760.095 279.844L737.042 288.832L715 285Z" fill="#A9BE9E" />
                    <path id="Vector_93" d="M715 285L768.732 237.005L760.095 279.844L737.042 288.832L715 285Z" fill="#7F9E87" />
                    <path id="Vector_94" d="M724.279 250.682L768.732 237.005L743.422 259.787L724.279 250.682Z" fill="#C6D6B5" />
                    <path id="Vector_95" d="M770 305L765.562 250.508L811.726 213.202L824.381 268.018L803.408 295.807L770 305Z" fill="#B9D6BE" />
                    <path id="Vector_96" d="M770 305L811.726 213.202L824.381 268.018L803.408 295.807L770 305Z" fill="#8FB5A0" />
                    <path id="Vector_97" d="M765.562 250.508L811.726 213.202L790.646 256.56L765.562 250.508Z" fill="#D4E5CD" />
                    <path id="Vector_98" d="M802 230L798.197 194.136L829.21 159.452L828.827 206.817L802 230Z" fill="#C2DCC8" />
                    <path id="Vector_99" d="M802 230L829.21 159.452L828.827 206.817L802 230Z" fill="#91B5A0" />
                    <path id="Vector_100" d="M798.197 194.136L829.21 159.452L813.698 193.649L798.197 194.136Z" fill="#DCE9D4" />
                    <path id="Vector_101" d="M807 311L823.941 281.81L868.066 280.19L849.62 317.352L826.271 319.93L807 311Z" fill="#A9BE9E" />
                    <path id="Vector_102" d="M807 311L868.066 280.19L849.62 317.352L826.271 319.93L807 311Z" fill="#7F9E87" />
                    <path id="Vector_103" d="M823.941 281.81L868.066 280.19L839.259 294.863L823.941 281.81Z" fill="#C6D6B5" />
                    <path id="Vector_104" d="M698 406L659.79 399.859L639.924 353.289L687.286 357.765L699.641 381.7L698 406Z" fill="#A9BE9E" />
                    <path id="Vector_105" d="M698 406L639.924 353.289L687.286 357.765L699.641 381.7L698 406Z" fill="#7F9E87" />
                    <path id="Vector_106" d="M659.79 399.859L639.924 353.289L667.469 378.098L659.79 399.859Z" fill="#C6D6B5" />
                    <path id="Vector_107" d="M746 384L733.157 343.65L761.495 307.454L780.596 346.617L769.61 371.242L746 384Z" fill="#B9D6BE" />
                    <path id="Vector_108" d="M746 384L761.495 307.454L780.596 346.617L769.61 371.242L746 384Z" fill="#8FB5A0" />
                    <path id="Vector_109" d="M733.157 343.65L761.495 307.454L753.141 343.848L733.157 343.65Z" fill="#D4E5CD" />
                    <path id="Vector_110" d="M728 476L745.516 446.788L788.622 438.253L761.411 473.762L728 476Z" fill="#C2DCC8" />
                    <path id="Vector_111" d="M728 476L788.622 438.253L761.411 473.762L728 476Z" fill="#91B5A0" />
                    <path id="Vector_112" d="M745.516 446.788L788.622 438.253L757.485 455.231L745.516 446.788Z" fill="#DCE9D4" />
                  </AnimatedLeafCluster>
                </g>

                {/* Branch Investments */}
                <g
                  id="branch-investments" onClick={() => onSelect('investments')}
                  className="transition-opacity duration-300 cursor-pointer"
                  style={{
                    opacity: selected && selected !== 'investments' ? 0.55 : 1
                  }}
                >
                  <motion.g
                    id="wood-investments"
                    animate={{ filter: getWoodFilter(scores.investments) }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                  >
                    <path id="Vector_113" d="M795 724L838 568L872 446L916 360L928 260L966 193L940 265L933 367L896 458L870 581L851 748L795 724Z" fill="#A78F70" />
                    <path id="Vector_114" d="M795 724L838 568L872 446L916 360L928 260L925 365L883 452L854 578L824 735L795 724Z" fill="#C4AC87" />
                    <path id="Vector_115" d="M882 455L838 376V291L820 247L850 291V370L898 428L882 455Z" fill="#9B856B" />
                    <path id="Vector_116" d="M919 385L994 329L1033 261L1004 341L926 410L919 385Z" fill="#B6A080" />
                    <path id="Twig_06" d="M930 304L978 280L996 229" strokeWidth="6" stroke="#9B856B" />
                    <path id="Twig_07" d="M994 329L1050 324L1082 295" strokeWidth="6" stroke="#9B856B" />
                    <path id="Twig_08" d="M850 334L886 289L884 242" strokeWidth="6" stroke="#9B856B" />
                    <path id="Twig_09" d="M1080 408L1033 370L1014 335" strokeWidth="6" stroke="#9B856B" />
                    <path id="Fine_twig_08" d="M885 290L916 230" strokeWidth="4" strokeLinejoin="bevel" stroke="#B6A080" />
                    <path id="Fine_twig_09" d="M978 280L1023 286" strokeWidth="4" strokeLinejoin="bevel" stroke="#B6A080" />
                    <path id="Fine_twig_10" d="M1033 370L1022 415" strokeWidth="4" strokeLinejoin="bevel" stroke="#B6A080" />
                  </motion.g>
                  <AnimatedLeafCluster id="leaves-investments" health={scores.investments}>
                    <path id="Vector_117" d="M839 291L795.379 279.846L778.708 233.898L824.784 238.74L840.799 262.521L839 291Z" fill="#B9D6BE" />
                    <path id="Vector_118" d="M839 291L778.708 233.898L824.784 238.74L840.799 262.521L839 291Z" fill="#8FB5A0" />
                    <path id="Vector_119" d="M795.379 279.846L778.708 233.898L806.818 261.936L795.379 279.846Z" fill="#D4E5CD" />
                    <path id="Vector_120" d="M821 249L794.925 231.326L796.29 190.138L829.689 209.732L830.569 231.639L821 249Z" fill="#A9BE9E" />
                    <path id="Vector_121" d="M821 249L796.29 190.138L829.689 209.732L830.569 231.639L821 249Z" fill="#7F9E87" />
                    <path id="Vector_122" d="M794.925 231.326L796.29 190.138L808.075 217.914L794.925 231.326Z" fill="#C6D6B5" />
                    <path id="Vector_123" d="M885 246L859.865 207.375L875.054 149.896L902.094 204.044L885 246Z" fill="#C2DCC8" />
                    <path id="Vector_124" d="M885 246L875.054 149.896L902.094 204.044L885 246Z" fill="#91B5A0" />
                    <path id="Vector_125" d="M859.865 207.375L875.054 149.896L877.231 197.828L859.865 207.375Z" fill="#DCE9D4" />
                    <path id="Vector_126" d="M916 234L899.07 193.439L925.097 153.448L948.391 192.215L939.259 218.672L916 234Z" fill="#B9D6BE" />
                    <path id="Vector_127" d="M916 234L925.097 153.448L948.391 192.215L939.259 218.672L916 234Z" fill="#8FB5A0" />
                    <path id="Vector_128" d="M899.07 193.439L925.097 153.448L919.752 191.835L899.07 193.439Z" fill="#D4E5CD" />
                    <path id="Vector_129" d="M939 265L942.079 222.361L991.414 196.016L991.049 248.566L965.898 264.466L939 265Z" fill="#A9BE9E" />
                    <path id="Vector_130" d="M939 265L991.415 196.016L991.049 248.566L965.898 264.466L939 265Z" fill="#7F9E87" />
                    <path id="Vector_131" d="M942.079 222.361L991.414 196.016L966.765 228.715L942.079 222.361Z" fill="#C6D6B5" />
                    <path id="Vector_132" d="M965 198L951.626 158.389L978.977 122.168L998.508 160.499L988.088 184.998L965 198Z" fill="#B9D6BE" />
                    <path id="Vector_133" d="M965 198L978.978 122.168L998.508 160.499L988.088 184.998L965 198Z" fill="#8FB5A0" />
                    <path id="Vector_134" d="M951.626 158.389L978.977 122.168L971.358 158.239L951.626 158.389Z" fill="#D4E5CD" />
                    <path id="Vector_135" d="M980 283L998.69 239.693L1048.97 229.973L1036.4 276.855L1009.17 289.528L980 283Z" fill="#B9D6BE" />
                    <path id="Vector_136" d="M980 283L1048.97 229.973L1036.4 276.855L1009.17 289.528L980 283Z" fill="#8FB5A0" />
                    <path id="Vector_137" d="M998.69 239.693L1048.97 229.973L1015.35 254.463L998.69 239.693Z" fill="#D4E5CD" />
                    <path id="Vector_138" d="M997 232L994.097 191.029L1030.77 152.784L1028.46 206.68L997 232Z" fill="#C2DCC8" />
                    <path id="Vector_139" d="M997 232L1030.77 152.784L1028.46 206.68L997 232Z" fill="#91B5A0" />
                    <path id="Vector_140" d="M994.097 191.029L1030.77 152.784L1011.76 191.09L994.097 191.029Z" fill="#DCE9D4" />
                    <path id="Vector_141" d="M1023 287L1034.4 250.017L1083.28 236.825L1072.26 283.103L1046.83 292.006L1023 287Z" fill="#A9BE9E" />
                    <path id="Vector_142" d="M1023 287L1083.28 236.825L1072.26 283.103L1046.83 292.006L1023 287Z" fill="#7F9E87" />
                    <path id="Vector_143" d="M1034.4 250.017L1083.28 236.825L1054.88 260.649L1034.4 250.017Z" fill="#C6D6B5" />
                    <path id="Vector_144" d="M1049 326L1072.23 289.32L1119.33 287.722L1101.16 328.535L1074.58 336.136L1049 326Z" fill="#B9D6BE" />
                    <path id="Vector_145" d="M1049 326L1119.33 287.722L1101.16 328.535L1074.58 336.136L1049 326Z" fill="#8FB5A0" />
                    <path id="Vector_146" d="M1072.23 289.32L1119.33 287.722L1085.24 305.146L1072.23 289.32Z" fill="#D4E5CD" />
                    <path id="Vector_147" d="M1081 297L1084.63 262.126L1121.14 235.41L1111.2 280.376L1081 297Z" fill="#C2DCC8" />
                    <path id="Vector_148" d="M1081 297L1121.14 235.41L1111.2 280.376L1081 297Z" fill="#91B5A0" />
                    <path id="Vector_149" d="M1084.63 262.126L1121.14 235.41L1099.47 264.796L1084.63 262.126Z" fill="#DCE9D4" />
                    <path id="Vector_150" d="M848 372L807.055 372.622L777.796 327.743L827.973 323.705L845.245 346.377L848 372Z" fill="#A9BE9E" />
                    <path id="Vector_151" d="M848 372L777.796 327.743L827.972 323.704L845.245 346.377L848 372Z" fill="#7F9E87" />
                    <path id="Vector_152" d="M807.055 372.622L777.796 327.743L811.058 348.534L807.055 372.622Z" fill="#C6D6B5" />
                    <path id="Vector_153" d="M890 295L888.916 257.495L921.893 233.587L928.597 271.608L913.226 289.899L890 295Z" fill="#B9D6BE" />
                    <path id="Vector_154" d="M890 295L921.893 233.587L928.597 271.608L913.226 289.899L890 295Z" fill="#8FB5A0" />
                    <path id="Vector_155" d="M888.916 257.495L921.893 233.587L905.889 262.544L888.916 257.495Z" fill="#D4E5CD" />
                    <path id="Vector_156" d="M923 365L887.99 334.196L894.211 283.955L934.454 310.089L938.051 339.565L923 365Z" fill="#B9D6BE" />
                    <path id="Vector_157" d="M923 365L894.21 283.955L934.453 310.089L938.051 339.565L923 365Z" fill="#8FB5A0" />
                    <path id="Vector_158" d="M887.99 334.196L894.211 283.955L906.967 323.047L887.99 334.196Z" fill="#D4E5CD" />
                    <path id="Vector_159" d="M994 342L989.071 306.339L1025.1 276.001L1034 319.35L1016.06 336.851L994 342Z" fill="#A9BE9E" />
                    <path id="Vector_160" d="M994 342L1025.1 276.001L1034 319.35L1016.06 336.851L994 342Z" fill="#7F9E87" />
                    <path id="Vector_161" d="M989.071 306.339L1025.1 276.001L1010.52 307.251L989.071 306.339Z" fill="#C6D6B5" />
                    <path id="Vector_162" d="M885 447L896.71 412.889L939.476 394.561L919.111 437.327L885 447Z" fill="#C2DCC8" />
                    <path id="Vector_163" d="M885 447L939.476 394.561L919.111 437.327L885 447Z" fill="#91B5A0" />
                    <path id="Vector_164" d="M896.71 412.889L939.476 394.561L910.965 418.999L896.71 412.889Z" fill="#DCE9D4" />
                    <path id="Vector_165" d="M1035 371L996.903 367.58L974.105 323.033L1021.11 324.181L1034.94 346.928L1035 371Z" fill="#A9BE9E" />
                    <path id="Vector_166" d="M1035 371L974.105 323.033L1021.11 324.181L1034.94 346.928L1035 371Z" fill="#7F9E87" />
                    <path id="Vector_167" d="M996.903 367.58L974.105 323.033L1002.97 345.595L996.903 367.58Z" fill="#C6D6B5" />
                  </AnimatedLeafCluster>
                </g>

                {/* Branch Spending */}
                <g
                  id="branch-spending" onClick={() => onSelect('spending')}
                  className="transition-opacity duration-300 cursor-pointer"
                  style={{
                    opacity: selected && selected !== 'spending' ? 0.55 : 1
                  }}
                >
                  <motion.g
                    id="wood-spending"
                    animate={{ filter: getWoodFilter(scores.spending) }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                  >
                    <path id="Vector_168" d="M817 814L894 696L982 617L1054 536L1149 474L1205 394L1257 357L1214 406L1164 490L1079 556L1008 643L922 723L866 835L817 814Z" fill="#A78F70" />
                    <path id="Vector_169" d="M817 814L894 696L982 617L1054 536L1149 474L1205 394L1157 483L1067 548L994 634L911 712L846 827L817 814Z" fill="#C4AC87" />
                    <path id="Vector_170" d="M1060 555L1055 469L1084 389L1089 336L1094 390L1070 472L1080 544L1060 555Z" fill="#9B856B" />
                    <path id="Vector_171" d="M1149 494L1230 496L1290 467L1236 509L1127 518L1149 494Z" fill="#B6A080" />
                    <path id="Vector_172" d="M985 634L979 548L946 499L934 452L957 494L995 542L1009 615L985 634Z" fill="#A78F70" />
                    <path id="Twig_10" d="M1206 401L1195 350L1207 315" strokeWidth="6" stroke="#9B856B" />
                    <path id="Twig_11" d="M1230 498L1268 543L1312 557" strokeWidth="6" stroke="#9B856B" />
                    <path id="Twig_12" d="M995 573L1033 591L1090 585" strokeWidth="6" stroke="#9B856B" />
                    <path id="Fine_twig_11" d="M1196 351L1158 322" strokeWidth="4" strokeLinejoin="bevel" stroke="#B6A080" />
                    <path id="Fine_twig_12" d="M1268 543L1245 583" strokeWidth="4" strokeLinejoin="bevel" stroke="#B6A080" />
                    <path id="Fine_twig_13" d="M1090 585L1123 555" strokeWidth="4" strokeLinejoin="bevel" stroke="#B6A080" />
                  </motion.g>
                  <AnimatedLeafCluster id="leaves-spending" health={scores.spending}>
                    <path id="Vector_173" d="M1087 340L1063.61 297.198L1087.7 250.041L1117.9 290.125L1110.89 320.384L1087 340Z" fill="#B9D6BE" />
                    <path id="Vector_174" d="M1087 340L1087.7 250.042L1117.9 290.125L1110.89 320.384L1087 340Z" fill="#8FB5A0" />
                    <path id="Vector_175" d="M1063.61 297.198L1087.7 250.041L1086.25 293.028L1063.61 297.198Z" fill="#D4E5CD" />
                    <path id="Vector_176" d="M1158 325L1126.78 301.516L1122.21 251.318L1159.45 286.617L1158 325Z" fill="#C2DCC8" />
                    <path id="Vector_177" d="M1158 325L1122.21 251.318L1159.45 286.617L1158 325Z" fill="#91B5A0" />
                    <path id="Vector_178" d="M1126.78 301.516L1122.21 251.318L1137.84 288.874L1126.78 301.516Z" fill="#DCE9D4" />
                    <path id="Vector_179" d="M1197 352L1177.1 308.645L1203.82 264.28L1230.55 305.449L1221.65 334.492L1197 352Z" fill="#B9D6BE" />
                    <path id="Vector_180" d="M1197 352L1203.82 264.28L1230.55 305.449L1221.65 334.492L1197 352Z" fill="#8FB5A0" />
                    <path id="Vector_181" d="M1177.1 308.645L1203.82 264.28L1199.47 306.122L1177.1 308.645Z" fill="#D4E5CD" />
                    <path id="Vector_182" d="M1207 319L1212.5 284.789L1254.19 267.002L1250.19 309.407L1228.76 320.469L1207 319Z" fill="#A9BE9E" />
                    <path id="Vector_183" d="M1207 319L1254.19 267.002L1250.19 309.407L1228.76 320.469L1207 319Z" fill="#7F9E87" />
                    <path id="Vector_184" d="M1212.5 284.789L1254.19 267.002L1231.98 291.664L1212.5 284.789Z" fill="#C6D6B5" />
                    <path id="Vector_185" d="M1254 361L1270.16 314.977L1321.32 301.324L1311.74 350.592L1284.56 365.63L1254 361Z" fill="#B9D6BE" />
                    <path id="Vector_186" d="M1254 361L1321.32 301.324L1311.74 350.592L1284.56 365.63L1254 361Z" fill="#8FB5A0" />
                    <path id="Vector_187" d="M1270.16 314.977L1321.32 301.324L1288.4 329.012L1270.16 314.977Z" fill="#D4E5CD" />
                    <path id="Vector_188" d="M1212 405L1235.23 370.73L1289.36 372.524L1263.61 416.42L1234.82 417.576L1212 405Z" fill="#A9BE9E" />
                    <path id="Vector_189" d="M1212 405L1289.36 372.524L1263.61 416.42L1234.82 417.576L1212 405Z" fill="#7F9E87" />
                    <path id="Vector_190" d="M1235.23 370.73L1289.36 372.524L1252.86 388.013L1235.23 370.73Z" fill="#C6D6B5" />
                    <path id="Vector_191" d="M1153 438L1111.9 408.854L1112.91 354.165L1159.11 377.702L1166.3 408.969L1153 438Z" fill="#B9D6BE" />
                    <path id="Vector_192" d="M1153 438L1112.91 354.165L1159.11 377.702L1166.3 408.969L1153 438Z" fill="#8FB5A0" />
                    <path id="Vector_193" d="M1111.9 408.854L1112.91 354.165L1131.03 394.73L1111.9 408.854Z" fill="#D4E5CD" />
                    <path id="Vector_194" d="M1090 393L1101.84 351.58L1151.7 327.045L1130.08 379.329L1090 393Z" fill="#C2DCC8" />
                    <path id="Vector_195" d="M1090 393L1151.7 327.045L1130.08 379.329L1090 393Z" fill="#91B5A0" />
                    <path id="Vector_196" d="M1101.84 351.58L1151.7 327.045L1119.22 357.977L1101.84 351.58Z" fill="#DCE9D4" />
                    <path id="Vector_197" d="M1023 416L990.768 409.659L975.295 369.564L1015.34 374.764L1025.11 395.435L1023 416Z" fill="#A9BE9E" />
                    <path id="Vector_198" d="M1023 416L975.295 369.564L1015.34 374.764L1025.11 395.435L1023 416Z" fill="#7F9E87" />
                    <path id="Vector_199" d="M990.768 409.659L975.295 369.564L997.926 391.426L990.768 409.659Z" fill="#C6D6B5" />
                    <path id="Vector_200" d="M1070 471L1062.09 424.5L1098.96 388.966L1113.96 435.126L1098.02 460.587L1070 471Z" fill="#B9D6BE" />
                    <path id="Vector_201" d="M1070 471L1098.96 388.966L1113.96 435.126L1098.02 460.587L1070 471Z" fill="#8FB5A0" />
                    <path id="Vector_202" d="M1062.09 424.5L1098.96 388.966L1084.1 427.816L1062.09 424.5Z" fill="#D4E5CD" />
                    <path id="Vector_203" d="M1232 499L1230.69 458.971L1274.08 429.594L1278.89 478.591L1257.01 495.868L1232 499Z" fill="#A9BE9E" />
                    <path id="Vector_204" d="M1232 499L1274.08 429.594L1278.88 478.591L1257.01 495.868L1232 499Z" fill="#7F9E87" />
                    <path id="Vector_205" d="M1230.69 458.971L1274.08 429.594L1254.32 462.474L1230.69 458.971Z" fill="#C6D6B5" />
                    <path id="Vector_206" d="M1290 470L1310.68 430.006L1359.2 424.098L1344.12 467.904L1317.34 478.159L1290 470Z" fill="#B9D6BE" />
                    <path id="Vector_207" d="M1290 470L1359.2 424.098L1344.12 467.904L1317.34 478.159L1290 470Z" fill="#8FB5A0" />
                    <path id="Vector_208" d="M1310.68 430.006L1359.2 424.098L1325.56 445.18L1310.68 430.006Z" fill="#D4E5CD" />
                    <path id="Vector_209" d="M1268 544L1300.48 515.708L1355.67 522.29L1309.06 554.366L1268 544Z" fill="#C2DCC8" />
                    <path id="Vector_210" d="M1268 544L1355.67 522.29L1309.06 554.366L1268 544Z" fill="#91B5A0" />
                    <path id="Vector_211" d="M1300.48 515.708L1355.67 522.29L1311.58 530.542L1300.48 515.708Z" fill="#DCE9D4" />
                    <path id="Vector_212" d="M1311 558L1339.58 544.752L1374.18 567.136L1340.18 585.672L1320.95 575.144L1311 558Z" fill="#A9BE9E" />
                    <path id="Vector_213" d="M1311 558L1374.18 567.136L1340.18 585.672L1320.95 575.144L1311 558Z" fill="#7F9E87" />
                    <path id="Vector_214" d="M1339.58 544.752L1374.18 567.136L1344.3 562.932L1339.58 544.752Z" fill="#C6D6B5" />
                    <path id="Vector_215" d="M1246 583L1285.28 593.779L1299.64 635.608L1258.04 630.5L1243.92 608.734L1246 583Z" fill="#B9D6BE" />
                    <path id="Vector_216" d="M1246 583L1299.64 635.608L1258.04 630.5L1243.92 608.734L1246 583Z" fill="#8FB5A0" />
                    <path id="Vector_217" d="M1285.28 593.779L1299.64 635.608L1274.65 609.8L1285.28 593.779Z" fill="#D4E5CD" />
                    <path id="Vector_218" d="M1156 493L1186.51 477.543L1224.9 500.519L1188.72 521.92L1167.45 511.225L1156 493Z" fill="#A9BE9E" />
                    <path id="Vector_219" d="M1156 493L1224.9 500.519L1188.72 521.92L1167.45 511.225L1156 493Z" fill="#7F9E87" />
                    <path id="Vector_220" d="M1186.51 477.543L1224.9 500.519L1192.32 497.089L1186.51 477.543Z" fill="#C6D6B5" />
                    <path id="Vector_221" d="M1090 585L1109.03 546.573L1155.13 540.141L1141.5 582.105L1116.17 592.315L1090 585Z" fill="#B9D6BE" />
                    <path id="Vector_222" d="M1090 585L1155.13 540.141L1141.5 582.105L1116.17 592.315L1090 585Z" fill="#8FB5A0" />
                    <path id="Vector_223" d="M1109.03 546.573L1155.13 540.141L1123.45 560.775L1109.03 546.573Z" fill="#D4E5CD" />
                    <path id="Vector_224" d="M1122 557L1125.33 518.574L1164.96 488.491L1154.89 538.137L1122 557Z" fill="#C2DCC8" />
                    <path id="Vector_225" d="M1122 557L1164.96 488.491L1154.89 538.137L1122 557Z" fill="#91B5A0" />
                    <path id="Vector_226" d="M1125.33 518.574L1164.96 488.491L1141.7 521.226L1125.33 518.574Z" fill="#DCE9D4" />
                    <path id="Vector_227" d="M993 546L990.211 513.269L1024.49 487.343L1030.53 527.271L1013.35 542.361L993 546Z" fill="#A9BE9E" />
                    <path id="Vector_228" d="M993 546L1024.49 487.343L1030.53 527.271L1013.35 542.361L993 546Z" fill="#7F9E87" />
                    <path id="Vector_229" d="M990.211 513.269L1024.49 487.343L1009.71 515.124L990.211 513.269Z" fill="#C6D6B5" />
                    <path id="Vector_230" d="M949 496L918.778 473.764L920.241 433.058L954.33 451.183L959.28 474.558L949 496Z" fill="#B9D6BE" />
                    <path id="Vector_231" d="M949 496L920.241 433.058L954.33 451.183L959.28 474.558L949 496Z" fill="#8FB5A0" />
                    <path id="Vector_232" d="M918.778 473.764L920.241 433.058L933.207 463.497L918.778 473.764Z" fill="#D4E5CD" />
                    <path id="Vector_233" d="M1031 591L1063.52 592.674L1090.06 625.225L1047.88 618.194L1031 591Z" fill="#C2DCC8" />
                    <path id="Vector_234" d="M1031 591L1090.06 625.225L1047.88 618.194L1031 591Z" fill="#91B5A0" />
                    <path id="Vector_235" d="M1063.52 592.674L1090.06 625.225L1061.76 606.565L1063.52 592.674Z" fill="#DCE9D4" />
                  </AnimatedLeafCluster>
                </g>

                {/* Branch Auto */}
                <g
                  id="branch-auto" onClick={() => onSelect('auto')}
                  className="transition-opacity duration-300 cursor-pointer"
                  style={{
                    opacity: selected && selected !== 'auto' ? 0.55 : 1
                  }}
                >
                  <motion.g
                    id="wood-auto"
                    animate={{ filter: getWoodFilter(scores.auto) }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                  >
                    <path id="Vector_236" d="M845 894L941 824L1051 796L1130 746L1210 737L1280 686L1216 749L1138 761L1060 814L951 847L856 926L845 894Z" fill="#A78F70" />
                    <path id="Vector_237" d="M845 894L941 824L1051 796L1130 746L1210 737L1136 754L1056 805L945 837L851 911L845 894Z" fill="#C4AC87" />
                    <path id="Vector_238" d="M1130 758L1129 702L1100 660L1141 698L1145 751L1130 758Z" fill="#A78F70" />
                    <path id="Twig_15" d="M1209 743L1240 785L1283 802" strokeWidth="6" stroke="#9B856B" />
                    <path id="Twig_16" d="M1137 709L1179 668L1187 635" strokeWidth="6" stroke="#9B856B" />
                    <path id="Fine_twig_16" d="M1179 668L1224 656" strokeWidth="4" strokeLinejoin="bevel" stroke="#B6A080" />
                    <path id="Fine_twig_17" d="M1240 785L1217 821" strokeWidth="4" strokeLinejoin="bevel" stroke="#B6A080" />
                  </motion.g>
                  <AnimatedLeafCluster id="leaves-auto" health={scores.auto}>
                    <path id="Vector_239" d="M1103 664L1071.74 651.286L1063.99 607.816L1103.36 620.911L1109.16 643.674L1103 664Z" fill="#A9BE9E" />
                    <path id="Vector_240" d="M1103 664L1063.99 607.816L1103.36 620.911L1109.16 643.673L1103 664Z" fill="#7F9E87" />
                    <path id="Vector_241" d="M1071.74 651.286L1063.99 607.816L1082.53 634.301L1071.74 651.286Z" fill="#C6D6B5" />
                    <path id="Vector_242" d="M1137 703L1107.48 674.152L1115.31 630.035L1149.67 654.998L1151.48 681.217L1137 703Z" fill="#B9D6BE" />
                    <path id="Vector_243" d="M1137 703L1115.31 630.035L1149.67 654.997L1151.48 681.217L1137 703Z" fill="#8FB5A0" />
                    <path id="Vector_244" d="M1107.48 674.152L1115.31 630.035L1124.77 665.177L1107.48 674.152Z" fill="#D4E5CD" />
                    <path id="Vector_245" d="M1186 639L1175.42 604.521L1199.25 564.556L1207.91 611.124L1186 639Z" fill="#C2DCC8" />
                    <path id="Vector_246" d="M1186 639L1199.25 564.556L1207.91 611.124L1186 639Z" fill="#91B5A0" />
                    <path id="Vector_247" d="M1175.42 604.521L1199.25 564.556L1190.55 601.084L1175.42 604.521Z" fill="#DCE9D4" />
                    <path id="Vector_248" d="M1179 670L1189.62 628.456L1233.38 612.579L1228.77 656.461L1206.12 671.713L1179 670Z" fill="#B9D6BE" />
                    <path id="Vector_249" d="M1179 670L1233.38 612.579L1228.77 656.461L1206.12 671.713L1179 670Z" fill="#8FB5A0" />
                    <path id="Vector_250" d="M1189.62 628.456L1233.38 612.579L1206.68 639.35L1189.62 628.456Z" fill="#D4E5CD" />
                    <path id="Vector_251" d="M1223 658L1227.58 625.926L1266.27 608.616L1263.22 648.327L1243.36 659.018L1223 658Z" fill="#A9BE9E" />
                    <path id="Vector_252" d="M1223 658L1266.27 608.616L1263.22 648.327L1243.36 659.018L1223 658Z" fill="#7F9E87" />
                    <path id="Vector_253" d="M1227.58 625.926L1266.27 608.616L1245.91 632.035L1227.58 625.926Z" fill="#C6D6B5" />
                    <path id="Vector_254" d="M1276 690L1297.8 651.22L1345.92 647.059L1329.51 689.796L1302.72 699L1276 690Z" fill="#B9D6BE" />
                    <path id="Vector_255" d="M1276 690L1345.92 647.059L1329.51 689.796L1302.72 699L1276 690Z" fill="#8FB5A0" />
                    <path id="Vector_256" d="M1297.8 651.22L1345.92 647.059L1311.97 666.717L1297.8 651.22Z" fill="#D4E5CD" />
                    <path id="Vector_257" d="M1210 741L1221.8 706.988L1267.67 696.311L1255.92 738.977L1232 746.428L1210 741Z" fill="#A9BE9E" />
                    <path id="Vector_258" d="M1210 741L1267.67 696.311L1255.92 738.977L1232 746.428L1210 741Z" fill="#7F9E87" />
                    <path id="Vector_259" d="M1221.8 706.988L1267.67 696.311L1240.49 717.537L1221.8 706.988Z" fill="#C6D6B5" />
                    <path id="Vector_260" d="M1240 785L1277.77 755.856L1327 771.91L1292.91 807.22L1262.6 805.079L1240 785Z" fill="#B9D6BE" />
                    <path id="Vector_261" d="M1240 785L1327 771.91L1292.91 807.22L1262.6 805.079L1240 785Z" fill="#8FB5A0" />
                    <path id="Vector_262" d="M1277.77 755.856L1327 771.91L1285.26 777.089L1277.77 755.856Z" fill="#D4E5CD" />
                    <path id="Vector_263" d="M1282 802L1317.56 802.587L1347.78 837.11L1301.47 831.043L1282 802Z" fill="#C2DCC8" />
                    <path id="Vector_264" d="M1282 802L1347.78 837.11L1301.47 831.043L1282 802Z" fill="#91B5A0" />
                    <path id="Vector_265" d="M1317.56 802.587L1347.78 837.11L1316.17 817.818L1317.56 802.587Z" fill="#DCE9D4" />
                    <path id="Vector_266" d="M1218 820L1249.68 832.884L1257.53 876.933L1217.64 863.664L1211.76 840.598L1218 820Z" fill="#A9BE9E" />
                    <path id="Vector_267" d="M1218 820L1257.53 876.933L1217.64 863.664L1211.76 840.597L1218 820Z" fill="#7F9E87" />
                    <path id="Vector_268" d="M1249.68 832.884L1257.53 876.933L1238.74 850.095L1249.68 832.884Z" fill="#C6D6B5" />
                    <path id="Vector_269" d="M1137 757L1096.31 763.923L1065.22 731.661L1105.61 718.537L1127.89 732.481L1137 757Z" fill="#B9D6BE" />
                    <path id="Vector_270" d="M1137 757L1065.22 731.661L1105.61 718.537L1127.89 732.481L1137 757Z" fill="#8FB5A0" />
                    <path id="Vector_271" d="M1096.31 763.923L1065.22 731.661L1099.21 744.66L1096.31 763.923Z" fill="#D4E5CD" />
                    <path id="Vector_272" d="M1094 791L1124.43 794.268L1142.04 830.218L1104.46 828.644L1093.71 810.255L1094 791Z" fill="#A9BE9E" />
                    <path id="Vector_273" d="M1094 791L1142.04 830.218L1104.46 828.644L1093.71 810.255L1094 791Z" fill="#7F9E87" />
                    <path id="Vector_274" d="M1124.43 794.268L1142.04 830.218L1119.26 811.768L1124.43 794.268Z" fill="#C6D6B5" />
                  </AnimatedLeafCluster>
                </g>

                {/* Tree Trunk */}
                <motion.g
                  id="tree-trunk" onClick={() => onSelect('trunk')} style={{ cursor: 'pointer' }}
                  animate={{ filter: getWoodFilter(scores.trunk), opacity: dim('trunk') }}
                  transition={{ duration: 0.45, ease: 'easeOut' }}
                >
                  <path id="Vector_275" d="M721.392 964L731.629 950.53L741.747 847.315L729.605 753.579L756.925 659.843L739.723 564L774.127 615.608L803.471 695.652L833.826 633.512L863.17 581.905L854.063 703.024L882.395 787.282L868.229 877.858L882.395 960.009L885.451 964H721.392Z" fill="#B6A080" />
                  <path id="Vector_276" d="M723.881 964L731 955L741 857L729 768L756 679L739 588L773 637L777 733L755 802L783 903L771.269 964H723.881Z" fill="#C4AC87" />
                  <path id="Vector_277" d="M777 733L802 713L832 654L861 605L852 720L822 788L809 884L783 903L755 802L777 733Z" fill="#A78F70" />
                  <path id="Vector_278" d="M852 720L880 800L866 886L880 964V964H848.857L827 913L809 884L822 788L852 720Z" fill="#8D7962" />
                  <path id="Vector_279" d="M783 903L809 884L827 913L848.857 964H771.269L783 903Z" fill="#B6A080" />
                  <path id="Vector_280" d="M731 955L741 857L783 903L771.269 964H723.881L731 955Z" fill="#D0B995" />
                </motion.g>

                {/* Tree Foundation (cleaned ID without '#') */}
                <g id="tree-foundation">
                  <g id="soil-cross-section">
                    <path id="Vector_281" d="M150 986L274 971L420 987L564 971L708 978L801 964L940 981L1087 971L1228 987L1378 976L1450 994L1441 1198L1320 1266L1090 1284L838 1269L603 1286L359 1269L166 1206L150 986Z" fill="#796450" />
                    <path id="Vector_282" d="M150 986L274 971L420 987L564 971L708 978L801 964L940 981L1087 971L1228 987L1378 976L1450 994L1262 1039L1059 1016L849 1045L634 1023L392 1044L150 986Z" fill="#927A60" />
                    <path id="Vector_283" d="M150 986L392 1044L303 1145L166 1206L150 986Z" fill="#856C54" />
                    <path id="Vector_284" d="M392 1044L634 1023L558 1176L303 1145L392 1044Z" fill="#6B5949" />
                    <path id="Vector_285" d="M634 1023L849 1045L947 1183L558 1176L634 1023Z" fill="#725D4B" />
                    <path id="Vector_286" d="M1059 1016L1262 1039L1163 1162L947 1183L849 1045L1059 1016Z" fill="#685748" />
                    <path id="Vector_287" d="M1262 1039L1450 994L1441 1198L1163 1162L1262 1039Z" fill="#806952" />
                    <path id="Vector_288" d="M166 1206L303 1145L558 1176L603 1286L359 1269L166 1206Z" fill="#705D4D" />
                    <path id="Vector_289" d="M558 1176L947 1183L838 1269L603 1286L558 1176Z" fill="#806B56" />
                    <path id="Vector_290" d="M947 1183L1163 1162L1320 1266L1090 1284L838 1269L947 1183Z" fill="#75614E" />
                    <path id="Vector_291" d="M1163 1162L1441 1198L1320 1266L1163 1162Z" fill="#665648" />
                    <path id="Vector_292" d="M150 986L274 971L420 987L564 971L708 978L801 964L940 981L1087 971L1228 987L1378 976L1450 994L1370 992L1228 1000L1087 983L941 994L801 978L708 990L565 983L421 999L275 984L150 986Z" fill="#A68A6A" />
                  </g>
                  <motion.g
                    id="ground-line-wood"
                    animate={{ filter: getWoodFilter(scores.trunk), opacity: dim('trunk') }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                  >
                    <path id="Ground-line_wood_facet" d="M678 1021.1L721.391 964H885.451L934 1027.41L851.028 1011.62L792.34 1039L740.735 1016.88L678 1021.1Z" fill="#B6A080" />
                    <path id="Ground-line_wood_facet_2" d="M678 1022L723.881 964H771.269L768 981L678 1022Z" fill="#C4AC87" />
                    <path id="Ground-line_wood_facet_3" d="M880 964V964L931 1028L863 997L848.857 964H880Z" fill="#8D7962" />
                    <path id="Ground-line_wood_facet_4" d="M848.857 964L863 997L849 1013L791 1039L768 981L771.269 964H848.857Z" fill="#B6A080" />
                    <path id="Ground-line_wood_facet_5" d="M771.269 964L768 981L740 1018L678 1022L723.881 964H771.269Z" fill="#D0B995" />
                  </motion.g>
                  <motion.g
                    id="underground-roots" onClick={() => onSelect('roots')} style={{ cursor: 'pointer' }}
                    animate={{ filter: getWoodFilter(scores.roots), opacity: dim('roots') }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                  >
                    <path id="Vector_293" d="M719.475 977L768 1001.46L716.62 1049.36L632.89 1079.93L546.306 1090.12L471.139 1134.97L389.312 1149.23L317 1190L375.04 1141.08L459.722 1117.64L532.034 1068.72L616.715 1056.49L680.464 1023.88L719.475 977Z" fill="#B6A080" />
                    <path id="Vector_294" d="M696.859 1000L717 1024.85L667.962 1056.8L609.292 1081.66L531.357 1088.76L463.93 1129.59L393 1150L457.8 1122.49L524.351 1079.88L602.286 1069.23L660.957 1040.83L696.859 1000Z" fill="#C4AC87" />
                    <path id="Vector_295" d="M791 1005L737 1052L649 1082L558 1092L479 1136L393 1150L474 1127L551 1081L640 1073L707 1045L763 1009L791 1005Z" fill="#8D7962" />
                    <path id="Vector_296" d="M550 1080L508 1055L421 1056L360 1032L301 1034L359 1023L425 1044L513 1041L576 1075L550 1080Z" fill="#B6A080" />
                    <path id="Vector_297" d="M550 1080L508 1055L421 1056L360 1032L301 1034L360 1028L424 1050L512 1048L565 1077L550 1080Z" fill="#C4AC87" />
                    <path id="Vector_298" d="M646 1070L626 1136L580 1180L550 1233L566 1181L609 1131L622 1077L646 1070Z" fill="#B6A080" />
                    <path id="Vector_299" d="M646 1070L626 1136L580 1180L550 1233L574 1178L617 1134L635 1073L646 1070Z" fill="#C4AC87" />
                    <path id="Vector_300" d="M783 1002L829 1000L824 1073L796 1134L808 1185L775 1243L789 1183L774 1132L794 1062L783 1002Z" fill="#B6A080" />
                    <path id="Vector_301" d="M783.735 1023L806.059 1034.87L808 1082.34L785.676 1141.67L798.294 1189.14L775.971 1243L789.559 1188.23L775 1141.67L794.412 1077.77L783.735 1023Z" fill="#C4AC87" />
                    <path id="Vector_302" d="M806 1036.58L829 1023L824 1089.09L796 1144.32L808 1190.49L775 1243L798 1189.58L785 1142.51L808 1083.66L806 1036.58Z" fill="#8D7962" />
                    <path id="Vector_303" d="M838 988L878 994L924 1038L1001 1062L1071 1094L1153 1098L1229 1140L1308 1159L1357 1201L1300 1169L1223 1154L1147 1116L1065 1112L988 1082L913 1065L866 1038L838 988Z" fill="#B6A080" />
                    <path id="Vector_304" d="M896 1016L931.53 1021.21L972.389 1059.43L1040.78 1080.27L1102.96 1108.07L1175.8 1111.54L1243.3 1148.02L1313.48 1164.52L1357 1201L1309.92 1168.86L1239.75 1154.1L1174.02 1118.49L1100.3 1115.88L1034.57 1088.96L967.948 1070.72L927.089 1042.92L896 1016Z" fill="#C4AC87" />
                    <path id="Vector_305" d="M992 1072L1023 1128L1033 1182L1080 1228L1020 1189L1007 1134L973 1076L992 1072Z" fill="#B6A080" />
                    <path id="Vector_306" d="M992 1072L1023 1128L1033 1182L1080 1228L1026 1186L1015 1131L983 1074L992 1072Z" fill="#C4AC87" />
                    <path id="Vector_307" d="M1141 1107L1184 1060L1256 1049L1300 1025L1261 1061L1195 1074L1158 1114L1141 1107Z" fill="#B6A080" />
                    <path id="Vector_308" d="M1141 1107L1184 1060L1256 1049L1300 1025L1258 1055L1190 1067L1150 1111L1141 1107Z" fill="#C4AC87" />
                    <path id="Vector_309" d="M466 1128L451 1183L414 1216M611 1139L664 1173L692 1215M789 1148L736 1180L719 1228M1016 1159L958 1196L931 1230M1228 1148L1221 1200L1244 1236" strokeWidth="7" strokeLinecap="round" strokeLinejoin="bevel" stroke="#B6A080" />
                    <path id="Vector_310" d="M451 1183L478 1210M421 1050L405 1081L369 1097M580 1180L539 1187L506 1214M664 1173L690 1166L719 1179M789 1183L829 1208L847 1240M958 1196L908 1197M1189 1067L1172 1038M1258 1055L1302 1073L1340 1074M1221 1200L1184 1223" strokeWidth="4" strokeLinecap="round" strokeLinejoin="bevel" stroke="#C4AC87" />
                  </motion.g>
                </g>

                {/* Branch Debt */}
                <g
                  id="branch-debt" onClick={() => onSelect('debt')}
                  className="transition-opacity duration-300 cursor-pointer"
                  style={{
                    opacity: selected && selected !== 'debt' ? 0.55 : 1
                  }}
                >
                  <motion.g
                    id="wood-debt"
                    animate={{ filter: getWoodFilter(scores.debt) }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                  >
                    <path id="Vector_311" d="M775 876L675 805L584 778L489 727L405 711L351 669L411 699L498 714L591 758L685 783L792 835L775 876Z" fill="#A78F70" />
                    <path id="Vector_312" d="M775 876L675 805L584 778L489 727L405 711L498 721L590 769L682 796L784 855L775 876Z" fill="#C4AC87" />
                    <path id="Vector_313" d="M491 728L478 666L499 615L490 670L505 729L491 728Z" fill="#A78F70" />
                    <path id="Twig_13" d="M411 706L418 655L401 620" strokeWidth="6" stroke="#9B856B" />
                    <path id="Twig_14" d="M493 723L472 764L421 789" strokeWidth="6" stroke="#9B856B" />
                    <path id="Fine_twig_14" d="M418 655L452 630" strokeWidth="4" strokeLinejoin="bevel" stroke="#B6A080" />
                    <path id="Fine_twig_15" d="M472 764L486 805" strokeWidth="4" strokeLinejoin="bevel" stroke="#B6A080" />
                  </motion.g>
                  <AnimatedLeafCluster id="leaves-debt" health={scores.debt}>
                    {/* Note: Vector_329, Vector_330, and Vector_343 form a 3-facet leaf on the debt branch */}
                    <path id="Vector_314" d="M353 671L308.602 673.837L278.906 635.748L323.684 626.23L345.995 643.688L353 671Z" fill="#B9D6BE" />
                    <path id="Vector_315" d="M353 671L278.906 635.748L323.684 626.23L345.995 643.688L353 671Z" fill="#8FB5A0" />
                    <path id="Vector_316" d="M308.602 673.837L278.906 635.748L313.883 653.514L308.602 673.837Z" fill="#D4E5CD" />
                    <path id="Vector_317" d="M405 704L369.927 723.337L324.055 698.016L365.53 671.491L390.856 683.138L405 704Z" fill="#A9BE9E" />
                    <path id="Vector_318" d="M405 704L324.055 698.016L365.53 671.49L390.856 683.138L405 704Z" fill="#7F9E87" />
                    <path id="Vector_319" d="M369.927 723.337L324.055 698.016L362.324 700.699L369.927 723.337Z" fill="#C6D6B5" />
                    <path id="Vector_320" d="M401 624L370.98 600.591L367.384 551.61L403.068 586.631L401 624Z" fill="#C2DCC8" />
                    <path id="Vector_321" d="M401 624L367.384 551.61L403.068 586.632L401 624Z" fill="#91B5A0" />
                    <path id="Vector_322" d="M370.98 600.591L367.384 551.61L381.976 588.463L370.98 600.591Z" fill="#DCE9D4" />
                    <path id="Vector_323" d="M418 657L406.718 616.743L435.927 582.003L453.425 621.304L441.737 645.224L418 657Z" fill="#B9D6BE" />
                    <path id="Vector_324" d="M418 657L435.927 582.003L453.425 621.304L441.737 645.224L418 657Z" fill="#8FB5A0" />
                    <path id="Vector_325" d="M406.718 616.743L435.927 582.003L426.43 617.626L406.718 616.743Z" fill="#D4E5CD" />
                    <path id="Vector_326" d="M451 632L448.995 602.368L480.39 579.473L485.219 615.661L469.454 629.032L451 632Z" fill="#A9BE9E" />
                    <path id="Vector_327" d="M451 632L480.39 579.473L485.219 615.661L469.454 629.032L451 632Z" fill="#7F9E87" />
                    <path id="Vector_328" d="M448.995 602.368L480.39 579.473L466.594 604.353L448.995 602.368Z" fill="#C6D6B5" />
                    <path id="Vector_329" d="M495 621L482.807 582.693L509.71 548.33L527.844 585.509L517.415 608.888L495 621Z" fill="#B9D6BE" />
                    <path id="Vector_330" d="M495 621L509.71 548.33L527.844 585.509L517.415 608.888L495 621Z" fill="#8FB5A0" />
                    <path id="Vector_343" d="M482.807 582.693L509.71 548.33L501.78 582.88L482.807 582.693Z" fill="#D4E5CD" />
                    <path id="Vector_331" d="M488 674L500.235 640.622L545.71 630.871L533.373 672.793L509.624 679.738L488 674Z" fill="#A9BE9E" />
                    <path id="Vector_332" d="M488 674L545.71 630.871L533.373 672.794L509.624 679.739L488 674Z" fill="#7F9E87" />
                    <path id="Vector_333" d="M500.235 640.622L545.71 630.871L518.512 651.36L500.235 640.622Z" fill="#C6D6B5" />
                    <path id="Vector_334" d="M471 766L434.273 796.444L384.505 782.119L417.351 745.64L447.709 746.723L471 766Z" fill="#B9D6BE" />
                    <path id="Vector_335" d="M471 766L384.505 782.119L417.351 745.64L447.709 746.723L471 766Z" fill="#8FB5A0" />
                    <path id="Vector_336" d="M434.273 796.444L384.505 782.119L426.045 775.486L434.273 796.444Z" fill="#D4E5CD" />
                    <path id="Vector_337" d="M485 804L515.11 811.58L527.732 850.192L490.19 843.302L481.989 823.307L485 804Z" fill="#A9BE9E" />
                    <path id="Vector_338" d="M485 804L527.732 850.192L490.19 843.302L481.99 823.307L485 804Z" fill="#7F9E87" />
                    <path id="Vector_339" d="M515.11 811.58L527.732 850.192L507.452 828.436L515.11 811.58Z" fill="#C6D6B5" />
                    <path id="Vector_340" d="M536 741L547.162 702.939L588.128 689.674L582.447 730.091L561.018 743.459L536 741Z" fill="#B9D6BE" />
                    <path id="Vector_341" d="M536 741L588.127 689.674L582.447 730.091L561.018 743.459L536 741Z" fill="#8FB5A0" />
                    <path id="Vector_342" d="M547.162 702.939L588.128 689.674L562.578 713.56L547.162 702.939Z" fill="#D4E5CD" />
                  </AnimatedLeafCluster>
                </g>
              </g>

              <DeltaOverlay deltas={deltas} pulse={pulse} />
              <defs>
                <clipPath id="clip0_0_1">
                  <rect width="1600" height="1400" fill="white" />
                </clipPath>
              </defs>
            </svg>
  );
}
