import { AppLogo } from "@openbot/brand";
import { render } from "@solidjs/web";
import { flush } from "solid-js";
import { loadSvg } from "../../avatar-canvas";

export const FONT = '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

export async function drawLogo(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colors: { logo: string; logoEye: string },
): Promise<void> {
  const host = document.createElement("span");
  const dispose = render(() => <AppLogo variant="production" />, host);
  flush();
  const svg = host.querySelector("svg")?.cloneNode(true);
  dispose();
  if (!(svg instanceof SVGSVGElement)) return;
  svg.querySelector(".app-logo-background")?.setAttribute("fill", colors.logo);
  for (const eye of svg.querySelectorAll(".app-logo-eye")) {
    eye.setAttribute("fill", "none");
    eye.setAttribute("stroke", colors.logoEye);
    eye.setAttribute("stroke-width", "9.5");
    eye.setAttribute("stroke-linecap", "round");
    eye.setAttribute("stroke-linejoin", "round");
  }
  context.drawImage(await loadSvg(svg, size), x, y, size, size);
}

export function ellipsize(context: CanvasRenderingContext2D, text: string, width: number): string {
  let value = text;
  while (value && context.measureText(`${value}…`).width > width) {
    const space = value.lastIndexOf(" ");
    value = space > 0 ? value.slice(0, space) : value.slice(0, -1);
  }
  return `${value.replace(/[\s,.;:]+$/u, "")}…`;
}
