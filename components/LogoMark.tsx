import React from 'react';
import Svg, { Circle, Ellipse } from 'react-native-svg';

type Props = {
  size?: number;
  color?: string;
};

/** The Nucleus orbit mark — vector twin of assets/logo-mark.svg. */
export function LogoMark({ size = 32, color = '#C45C1A' }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Circle cx={32} cy={32} r={27} stroke={color} strokeWidth={1.5} />
      <Ellipse
        cx={32}
        cy={32}
        rx={27}
        ry={11}
        stroke={color}
        strokeWidth={1.5}
        rotation={60}
        originX={32}
        originY={32}
      />
      <Ellipse
        cx={32}
        cy={32}
        rx={27}
        ry={11}
        stroke={color}
        strokeWidth={1.5}
        rotation={-60}
        originX={32}
        originY={32}
      />
      <Circle cx={32} cy={32} r={6} fill={color} />
    </Svg>
  );
}
