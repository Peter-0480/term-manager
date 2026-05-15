/**
 * Minimal polyfills for browser APIs required by pdfjs-dist 4.x
 * in Node.js / Electron main process environment.
 *
 * These are loaded BEFORE any other module to satisfy pdfjs-dist's
 * initialization requirements.
 */

// ---- DOMMatrix ----
// pdfjs-dist uses DOMMatrix for coordinate transforms
class DOMMatrixPolyfill {
  m11 = 1; m12 = 0; m13 = 0; m14 = 0;
  m21 = 0; m22 = 1; m23 = 0; m24 = 0;
  m31 = 0; m32 = 0; m33 = 1; m34 = 0;
  m41 = 0; m42 = 0; m43 = 0; m44 = 1;

  get a() { return this.m11; } set a(v: number) { this.m11 = v; }
  get b() { return this.m21; } set b(v: number) { this.m21 = v; }
  get c() { return this.m12; } set c(v: number) { this.m12 = v; }
  get d() { return this.m22; } set d(v: number) { this.m22 = v; }
  get e() { return this.m41; } set e(v: number) { this.m41 = v; }
  get f() { return this.m42; } set f(v: number) { this.m42 = v; }

  constructor(init?: string | number[]) {
    if (typeof init === 'string') {
      // Parse CSS matrix() format: "matrix(a, b, c, d, e, f)"
      const parts = init.replace(/matrix\(|\)/g, '').split(',').map(Number);
      if (parts.length >= 6) {
        this.m11 = parts[0]; this.m21 = parts[1];
        this.m12 = parts[2]; this.m22 = parts[3];
        this.m41 = parts[4]; this.m42 = parts[5];
      }
    } else if (Array.isArray(init) && init.length >= 6) {
      this.m11 = init[0]; this.m21 = init[1];
      this.m12 = init[2]; this.m22 = init[3];
      this.m41 = init[4]; this.m42 = init[5];
    }
  }

  translateSelf(_tx: number, _ty: number) { return this; }
  scaleSelf(_sx: number, _sy?: number) { return this; }
  rotateSelf(_angle: number) { return this; }
  multiplySelf(_other: any) { return this; }
  transformPoint(_point: any) { return { x: 0, y: 0, z: 0, w: 1 }; }
  is2D = true;
  isIdentity = true;
}

// ---- DOMPoint ----
class DOMPointPolyfill {
  x = 0; y = 0; z = 0; w = 1;
  constructor(_x?: number, _y?: number, _z?: number, _w?: number) {
    if (_x !== undefined) this.x = _x;
    if (_y !== undefined) this.y = _y;
    if (_z !== undefined) this.z = _z;
    if (_w !== undefined) this.w = _w;
  }
  static fromPoint(other?: { x: number; y: number; z?: number; w?: number }) {
    if (other) return new DOMPointPolyfill(other.x, other.y, other.z, other.w);
    return new DOMPointPolyfill();
  }
  matrixTransform(_matrix: any) { return this; }
}

// ---- Path2D ----
class Path2DPolyfill {
  addPath(_path: any, _transform?: any) {}
  arc(_x: number, _y: number, _radius: number, _startAngle: number, _endAngle: number, _counterclockwise?: boolean) {}
  arcTo(_x1: number, _y1: number, _x2: number, _y2: number, _radius: number) {}
  bezierCurveTo(_cp1x: number, _cp1y: number, _cp2x: number, _cp2y: number, _x: number, _y: number) {}
  closePath() {}
  ellipse(_x: number, _y: number, _radiusX: number, _radiusY: number, _rotation: number, _startAngle: number, _endAngle: number, _counterclockwise?: boolean) {}
  lineTo(_x: number, _y: number) {}
  moveTo(_x: number, _y: number) {}
  quadraticCurveTo(_cpx: number, _cpy: number, _x: number, _y: number) {}
  rect(_x: number, _y: number, _w: number, _h: number) {}
  roundRect(_x: number, _y: number, _w: number, _h: number, _radii?: number | number[]) {}
}

// ---- ImageData ----
class ImageDataPolyfill {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly colorSpace: string = 'srgb';

  constructor(width: number, height: number);
  constructor(data: Uint8ClampedArray, width: number, height?: number);
  constructor(arg1: number | Uint8ClampedArray, arg2: number, arg3?: number) {
    if (arg1 instanceof Uint8ClampedArray) {
      this.data = arg1;
      this.width = arg2;
      this.height = arg3 ?? 0;
    } else {
      this.width = arg1;
      this.height = arg2;
      this.data = new Uint8ClampedArray(arg1 * arg2 * 4);
    }
  }
}

// ---- Install polyfills on globalThis ----
if (typeof globalThis.DOMMatrix === 'undefined') {
  (globalThis as any).DOMMatrix = DOMMatrixPolyfill;
}
if (typeof globalThis.DOMPoint === 'undefined') {
  (globalThis as any).DOMPoint = DOMPointPolyfill;
}
if (typeof globalThis.Path2D === 'undefined') {
  (globalThis as any).Path2D = Path2DPolyfill;
}
if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as any).ImageData = ImageDataPolyfill;
}

console.log('[PDF Polyfills] Installed DOMMatrix, DOMPoint, Path2D, ImageData polyfills for pdfjs-dist');