import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { gsap } from 'gsap';

/** Gama de caracteres de más LIGERO a más DENSO (el índice 0 es un espacio) */
export const DEFAULT_RAMP = ' .:-=+*#%@';

/**
 * Convierte una luminancia (0 = negro, 1 = blanco) en un índice de la gama
 * Zonas oscuras -> caracteres densos; zonas claras -> caracteres ligeros
 * `contrast` > 1 separa más los tonos (muy útil con fotos "planas")
 */
export function rampIndexForLuminance(lum: number, rampLength: number, contrast = 1): number {
  const c = Math.min(1, Math.max(0, (lum - 0.5) * contrast + 0.5));
  return Math.round((1 - c) * (rampLength - 1));
}

export function charForLuminance(lum: number, ramp = DEFAULT_RAMP, contrast = 1): string {
  return ramp[rampIndexForLuminance(lum, ramp.length, contrast)];
}

/**
 * Calcula el recorte "cover" (como object-fit: cover) de una imagen de iw×ih
 * para llenar un rectángulo con proporción `ar` (ancho/alto)
 * fx/fy (0..1) mueven el encuadre (0.5 = centrado)
 */
export function coverRect(iw: number, ih: number, ar: number, fx = 0.5, fy = 0.5) {
  let sw = iw;
  let sh = ih;
  if (iw / ih > ar) sw = ih * ar;
  else sh = iw / ar;
  return { sx: (iw - sw) * clamp01(fx), sy: (ih - sh) * clamp01(fy), sw, sh };
}

/** Hash determinista barato -> [0, 1). Se usa para el "parpadeo" de caracteres */
function hash01(a: number, b: number): number {
  let h = Math.imul(a, 2654435761) ^ Math.imul(b, 40503);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967295;
}

const smoothstep = (t: number) => t * t * (3 - 2 * t);
function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Ancho máximo (px) del lienzo base. Evita arrastrar fotos de 6000 px en cada frame */
const MAX_BASE_WIDTH = 1200;

interface AsciiGrid {
  cols: number;
  rows: number;
  idx: Uint8Array; // índice en la gama por celda
  fills: string[]; // color rgb() por celda (modo color)
}

@Component({
  selector: 'app-asciitransition-component',
  templateUrl: './asciitransition-component.html',
  styleUrl: './asciitransition-component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.width.px]': 'width()',
    '[style.aspect-ratio]': 'width() + " / " + height()',
  },
})
export class AsciitransitionComponent {
  // ---------- Inputs ----------
  readonly src = input.required<string>();
  readonly alt = input('Imagen con transición ASCII');

  /** Tamaño del recuadro. La imagen se recorta/adapta (cover) a esta proporción */
  readonly width = input(420);
  readonly height = input(654);
  /** Encuadre del recorte: 0 = izquierda/arriba, 0.5 = centro, 1 = derecha/abajo */
  readonly focusX = input(0.5);
  readonly focusY = input(0.5);

  /** Resolución horizontal en caracteres. más columnas = más detalle (y más coste) */
  readonly cols = input(120);
  /** Duración total de la transición en segundos */
  readonly duration = input(2.4);
  readonly ease = input('power1.inOut');
  readonly ramp = input(DEFAULT_RAMP);
  /** Contraste aplicado a la luminancia antes de elegir el carácter */
  readonly contrast = input(1.35);
  /** Invierte el mapeo (claro = denso). Útil sobre fondo oscuro para que la foto se vea "natural" */
  readonly invert = input(false);
  /** Si es true, cada carácter toma el color del píxel original */
  readonly color = input(false);

  // Tema oscuro por defecto
  readonly inkColor = input('#e8e6df');
  readonly paperColor = input('#0b0b0e');
  readonly fontFamily = input(`'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace`);

  /** Cuánto se "escalona" la onda (0 = todo a la vez, 0.8 = onda muy marcada) */
  readonly spread = input(0.55);
  /**
   * hover: al pasar el ratón por encima se lanza la animación completa ASCII -> imagen y se queda como imagen
   * click: alterna al hacer clic · none: sólo por API (toAscii / toImage / toggle)
   */
  readonly trigger = input<'click' | 'hover' | 'none'>('hover');
  /** Con trigger "hover": si es true, al sacar el ratón vuelve a ASCII. Por defecto se queda como imagen */
  readonly resetOnLeave = input(false);
  /** Si es true la onda nace en el punto donde interactúa el usuario; si no, en el centro */
  readonly originFromPointer = input(true);

  // ---------- Outputs / estado ----------
  readonly transitionEnd = output<boolean>();
  /** El componente arranca en modo ASCII */
  readonly isAscii = signal(true);
  readonly ready = signal(false);

  // ---------- Internos ----------
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  private ctx: CanvasRenderingContext2D | null = null;
  private img: HTMLImageElement | null = null;
  private base: HTMLCanvasElement | null = null; // imagen ya recortada y reducida
  private loadedSrc = '';
  private grid: AsciiGrid | null = null;
  private dist: Float32Array | null = null;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private origin = { x: 0.5, y: 0.5 };
  private readonly state = { g: 1 }; // 0 = imagen, 1 = ASCII (arranca en ASCII)
  private pendingReveal = false; // hover ocurrido antes de que la imagen terminara de cargar
  private tween: gsap.core.Tween | null = null;
  private resizeObserver?: ResizeObserver;

  constructor() {
    // Re-procesa la imagen cuando cambia cualquier input que afecte al análisis.
    effect(() => {
      const canvas = this.canvasRef()?.nativeElement;
      const src = this.src();
      this.width();
      this.height();
      this.focusX();
      this.focusY();
      this.cols();
      this.ramp();
      this.contrast();
      this.invert();
      this.color();
      if (!canvas) return;
      untracked(() => this.prepare(canvas, src));
    });

    // Redibuja si cambian estilos puros
    effect(() => {
      this.inkColor();
      this.paperColor();
      this.fontFamily();
      this.spread();
      untracked(() => this.draw());
    });

    afterNextRender(() => {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.host.nativeElement);
    });

    this.destroyRef.onDestroy(() => {
      this.tween?.kill();
      this.resizeObserver?.disconnect();
    });
  }

  // ---------- API pública ----------
  toAscii(origin?: { x: number; y: number }): void {
    this.animateTo(1, origin);
  }

  toImage(origin?: { x: number; y: number }): void {
    this.animateTo(0, origin);
  }

  toggle(origin?: { x: number; y: number }): void {
    this.animateTo(this.isAscii() ? 0 : 1, origin);
  }

  // ---------- Eventos ----------
  onClick(ev: MouseEvent): void {
    if (this.trigger() === 'click') this.toggle(this.originFrom(ev));
  }

  onPointerEnter(ev: PointerEvent): void {
    if (this.trigger() !== 'hover' || !this.isAscii()) return;
    if (!this.ready()) {
      this.pendingReveal = true;
      return;
    }
    this.toImage(this.originFrom(ev));
  }

  onPointerLeave(ev: PointerEvent): void {
    if (this.trigger() === 'hover' && this.resetOnLeave() && !this.isAscii()) {
      this.toAscii(this.originFrom(ev));
    }
  }

  // ---------- Lógica ----------
  private originFrom(ev: MouseEvent): { x: number; y: number } | undefined {
    if (!this.originFromPointer()) return undefined;
    const rect = this.host.nativeElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return undefined;
    return { x: (ev.clientX - rect.left) / rect.width, y: (ev.clientY - rect.top) / rect.height };
  }

  private animateTo(target: 0 | 1, origin?: { x: number; y: number }): void {
    if (origin) this.origin = { x: clamp01(origin.x), y: clamp01(origin.y) };
    else if (!this.originFromPointer()) this.origin = { x: 0.5, y: 0.5 };
    this.computeDistances();

    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.isAscii.set(target === 1);
    this.tween?.kill();
    this.tween = gsap.to(this.state, {
      g: target,
      duration: reduced ? 0.01 : this.duration(),
      ease: this.ease(),
      onUpdate: () => this.draw(),
      onComplete: () => {
        this.draw();
        this.transitionEnd.emit(target === 1);
      },
    });
  }

  /** Carga la imagen (si cambió) y reconstruye lienzo base + cuadrícula ASCII. */
  private prepare(canvas: HTMLCanvasElement, src: string): void {
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) return;

    if (this.img && this.loadedSrc === src && this.img.complete) {
      this.rebuild();
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous'; // necesario para getImageData con imágenes de otro dominio (con CORS)
    img.onload = () => {
      this.img = img;
      this.loadedSrc = src;
      this.rebuild();
      this.ready.set(true);
      if (this.pendingReveal) {
        this.pendingReveal = false;
        this.toImage();
      }
    };
    img.onerror = () => this.ready.set(false);
    img.src = src;
  }

  private rebuild(): void {
    this.buildBase();
    this.buildGrid();
    this.resize();
  }

  /**
   * Recorta la imagen a la proporción del recuadro (cover) y la reduce a un
   * lienzo de como mucho MAX_BASE_WIDTH px. Así una foto enorme no pesa en cada frame.
   */
  private buildBase(): void {
    const img = this.img;
    if (!img || !img.naturalWidth) return;

    const ar = this.width() / this.height();
    const { sx, sy, sw, sh } = coverRect(
      img.naturalWidth,
      img.naturalHeight,
      ar,
      this.focusX(),
      this.focusY(),
    );

    const bw = Math.max(1, Math.round(Math.min(sw, MAX_BASE_WIDTH)));
    const bh = Math.max(1, Math.round(bw / ar));
    const base = document.createElement('canvas');
    base.width = bw;
    base.height = bh;
    const bctx = base.getContext('2d');
    if (!bctx) return;
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(img, sx, sy, sw, sh, 0, 0, bw, bh);
    this.base = base;
  }

  /** Analiza el lienzo base: reduce a cols×rows y convierte cada píxel en un índice de la gama. */
  private buildGrid(): void {
    const base = this.base;
    if (!base) return;

    const ar = this.width() / this.height();
    const cols = Math.max(8, Math.round(this.cols()));
    // Las celdas son ~2 veces más altas que anchas, por eso se divide entre 2.
    const rows = Math.max(4, Math.round(cols / ar / 2));

    const off = document.createElement('canvas');
    off.width = cols;
    off.height = rows;
    const octx = off.getContext('2d', { willReadFrequently: true });
    if (!octx) return;
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(base, 0, 0, cols, rows);

    let data: Uint8ClampedArray;
    try {
      data = octx.getImageData(0, 0, cols, rows).data;
    } catch {
      console.warn('[asciitransition] Canvas "tainted": la imagen necesita CORS o ser del mismo origen.');
      return;
    }

    const ramp = this.ramp();
    const contrast = this.contrast();
    const invert = this.invert();
    const idx = new Uint8Array(cols * rows);
    const fills: string[] = new Array(cols * rows);

    for (let i = 0; i < cols * rows; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      let lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      if (invert) lum = 1 - lum;
      idx[i] = rampIndexForLuminance(lum, ramp.length, contrast);
      fills[i] = `rgb(${r},${g},${b})`;
    }

    this.grid = { cols, rows, idx, fills };
    this.computeDistances();
  }

  private resize(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas || !this.base) return;

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    // El host tiene `width` px pero nunca más que su contenedor (max-width: 100%).
    this.cssW = this.host.nativeElement.clientWidth || this.width();
    this.cssH = (this.cssW * this.height()) / this.width();

    canvas.width = Math.round(this.cssW * this.dpr);
    canvas.height = Math.round(this.cssH * this.dpr);
    canvas.style.height = `${this.cssH}px`;

    this.computeDistances();
    this.draw();
  }

  /** Distancia normalizada [0,1] de cada celda al origen de la onda. */
  private computeDistances(): void {
    const grid = this.grid;
    if (!grid || !this.cssW) return;
    const { cols, rows } = grid;
    const cw = this.cssW / cols;
    const ch = this.cssH / rows;
    const ox = this.origin.x * this.cssW;
    const oy = this.origin.y * this.cssH;

    const dist = new Float32Array(cols * rows);
    let max = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const d = Math.hypot((c + 0.5) * cw - ox, (r + 0.5) * ch - oy);
        dist[r * cols + c] = d;
        if (d > max) max = d;
      }
    }
    if (max > 0) for (let i = 0; i < dist.length; i++) dist[i] /= max;
    this.dist = dist;
  }

  private draw(): void {
    const ctx = this.ctx;
    const grid = this.grid;
    const base = this.base;
    const dist = this.dist;
    if (!ctx || !grid || !base || !dist || !this.cssW) return;

    const { cols, rows, idx, fills } = grid;
    const g = this.state.g;
    const W = this.cssW;
    const H = this.cssH;
    const cw = W / cols;
    const ch = H / rows;
    const ramp = this.ramp();
    const spread = Math.min(0.9, Math.max(0, this.spread()));
    const useColor = this.color();
    const ink = this.inkColor();
    const paper = this.paperColor();
    const tick = Math.floor(performance.now() / 70); // ritmo del parpadeo

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);

    // 1) Imagen original como base (se tapa celda a celda según avanza la onda).
    if (g < 1) ctx.drawImage(base, 0, 0, W, H);

    if (g <= 0) return;

    ctx.font = `${ch * 1.02}px ${this.fontFamily()}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const local = clamp01((g - dist[i] * spread) / (1 - spread));
        if (local <= 0) continue;

        const p = smoothstep(local);
        const x = c * cw;
        const y = r * ch;

        // 2) Papel: funde la imagen hacia el fondo del ASCII.
        ctx.globalAlpha = p;
        ctx.fillStyle = paper;
        ctx.fillRect(x, y, cw + 0.6, ch + 0.6);

        // 3) Carácter. Durante la transición "parpadea" entre símbolos al azar.
        let k = idx[i];
        if (local < 1 && hash01(i, tick) < Math.sin(local * Math.PI) * 0.6) {
          k = Math.floor(hash01(i + 7919, tick) * ramp.length);
        }
        if (k === 0) continue; // espacio

        ctx.fillStyle = useColor ? fills[i] : ink;
        ctx.fillText(ramp[k], x + cw / 2, y + ch / 2);
      }
    }
    ctx.globalAlpha = 1;
  }
}