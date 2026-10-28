import React from 'react';

/**
 * DXFAST Brand Symbol (Icon version - Logo 2)
 * High-precision vector reproduction of the authentic red mark.
 * The central dynamic curve is a transparent cutout (negative space), NOT black.
 */
export const DxFastIcon: React.FC<{
  className?: string;
  size?: number | string;
  color?: string;
}> = ({ className = 'w-10 h-10', size, color = '#FF3000' }) => {
  const maskId = React.useId();

  return (
    <svg
      viewBox="0 0 1000 1000"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={size ? { width: size, height: size } : undefined}
      aria-label="DXFAST Ícone"
    >
      <defs>
        <mask id={maskId}>
          {/* Opaque white base so the red fills the whole square */}
          <rect width="1000" height="1000" fill="#FFFFFF" />
          {/* Black cutout path: makes the middle channel 100% transparent */}
          <path
            d="M -10 1010 C 120 860 260 720 415 575 C 435 440 455 240 450 -10 L 630 -10 C 640 260 610 420 585 495 C 700 460 840 440 1010 445 L 1010 580 C 820 580 670 610 535 660 C 330 740 160 860 -10 1010 Z"
            fill="#000000"
          />
        </mask>
      </defs>

      {/* Red square with authentic transparent cutout */}
      <rect
        width="1000"
        height="1000"
        fill={color}
        mask={`url(#${maskId})`}
      />
    </svg>
  );
};

/**
 * DXFAST Wordmark (Logo 3)
 * Exact typographic reproduction: all in vivid brand color (#FF3000).
 * 'DX' heavy bold + 'FAST' geometric regular.
 */
export const DxFastWordmark: React.FC<{
  className?: string;
  color?: string;
  height?: number | string;
}> = ({ className = 'h-7 w-auto', color = '#FF3000', height }) => {
  return (
    <div
      className={`inline-flex items-baseline select-none font-sans leading-none ${className}`}
      style={height ? { height } : undefined}
      aria-label="DXFAST"
    >
      <span
        style={{ color }}
        className="font-black text-2xl tracking-tighter"
      >
        DX
      </span>
      <span
        style={{ color }}
        className="font-normal text-2xl tracking-normal ml-0.5"
      >
        FAST
      </span>
    </div>
  );
};

/**
 * DXFAST Full Horizontal Branding (Header / Main Viewport)
 */
export const DxFastLogoHorizontal: React.FC<{
  className?: string;
  iconSize?: number;
  subtitle?: string;
}> = ({
  className = '',
  iconSize = 38,
  subtitle = 'Corte a Laser, Plasma & Dobra CNC',
}) => {
  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      {/* Icon with authentic transparent cutout */}
      <div className="shrink-0">
        <DxFastIcon size={iconSize} />
      </div>

      {/* Typography Block */}
      <div className="flex flex-col justify-center">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-black tracking-tighter font-sans text-[#FF3000] leading-none">
            DX<span className="font-normal tracking-normal ml-0.5">FAST</span>
          </span>
        </div>
        {subtitle && (
          <p className="text-[11px] font-medium tracking-normal mt-0.5 leading-tight text-slate-500">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
};

/**
 * DXFAST Stacked Brand (Logo 1 - Authentic transparent background)
 */
export const DxFastLogoStacked: React.FC<{
  className?: string;
  width?: number;
}> = ({ className = 'w-28', width }) => {
  return (
    <div
      className={`flex flex-col items-center gap-2 ${className}`}
      style={width ? { width } : undefined}
    >
      <DxFastIcon className="w-full h-auto aspect-square" />
      <div className="text-center">
        <span className="text-lg font-black tracking-tighter font-sans text-[#FF3000]">
          DX<span className="font-normal tracking-normal ml-0.5">FAST</span>
        </span>
      </div>
    </div>
  );
};

export default DxFastLogoHorizontal;
