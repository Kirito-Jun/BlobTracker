// ============================================================
//  CONFIG
// ============================================================
const trackerConfig = {
    speed: 1, skipFrames: 1, shape: 'square', baseStyle: 'base', filter: 'none',
    randomRegion: false, randomFilter: false, loopPlayback: true,
    invert: false, innerInvert: false, blend: false, centerHub: false,
    linkRate: 0.8, linkDist: 200, lineStyle: 'solid', strokeWidth: 1,
    sameSize: false, boundingSize: 60, minArea: 200, maxBlobs: 20, singleTrack: false,
    crazy: false, separateColor: false, mainColor: '#ffffff', lineColor: '#ffffff',
    textContent: '', textPosition: 'top', fontFamily: 'monospace',
    fontSize: 12, fontWeight: 'normal', textColor: '#ffffff',
    threshold: 100, dotSize: 3, invertFilter: false, flashLine: false
};

const PALETTES = {
    default: [],
    aurora:  ['#00c9ff','#92fe9d','#a18cd1','#fbc2eb','#00b09b'],
    sunset:  ['#f7971e','#ffd200','#fc4a1a','#f7b733','#ff6a00'],
    neon:    ['#ff0099','#9b59b6','#3498db','#00d2ff','#7f00ff'],
    ocean:   ['#1CB5E0','#000046','#0099F7','#43c6ac','#00b4db'],
    fire:    ['#f12711','#f5af19','#f7971e','#ff512f','#dd2476'],
};

const BASE_WIDTH = 1280;
const BASE_HEIGHT = 720;

let glowEffectListeners = [];

// ============================================================
//  COLORBENDS - Raw WebGL (no Three.js)
// ============================================================
const MAX_COLORS = 8;

const CB_VERT = `
attribute vec3 aPosition;
attribute vec2 aUv;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPosition, 1.0);
}`;

const CB_FRAG = `
precision highp float;
#define MAX_COLORS ${MAX_COLORS}
uniform vec2 uCanvas;
uniform float uTime;
uniform float uSpeed;
uniform vec2 uRot;
uniform float uRotSpeed;
uniform int uColorCount;
uniform vec3 uColors[MAX_COLORS];
uniform int uTransparent;
uniform float uScale;
uniform float uFrequency;
uniform float uWarpStrength;
uniform vec2 uPointer;
uniform float uMouseInfluence;
uniform float uParallax;
uniform float uNoise;
varying vec2 vUv;

void main() {
  float t = uTime * uSpeed;
  vec2 p = vUv * 2.0 - 1.0;
  p += uPointer * uParallax * 0.1;
  
  float rotAngle = uTime * uRotSpeed;
  float cosRot = cos(rotAngle);
  float sinRot = sin(rotAngle);
  
  vec2 rp = vec2(p.x * cosRot - p.y * sinRot, p.x * sinRot + p.y * cosRot);
  vec2 q = vec2(rp.x * (uCanvas.x / uCanvas.y), rp.y);
  q /= max(uScale, 0.0001);
  q /= 0.5 + 0.2 * dot(q, q);
  q += 0.2 * cos(t) - 7.56;
  vec2 toward = (uPointer - rp);
  q += toward * uMouseInfluence * 0.2;

  vec3 col = vec3(0.0);
  float a = 1.0;

  if (uColorCount > 0) {
    vec2 s = q;
    vec3 sumCol = vec3(0.0);
    float cover = 0.0;
    for (int i = 0; i < MAX_COLORS; ++i) {
      if (i >= uColorCount) break;
      s -= 0.01;
      vec2 r = sin(1.5 * (s.yx * uFrequency) + 2.0 * cos(s * uFrequency));
      float m0 = length(r + sin(5.0 * r.y * uFrequency - 3.0 * t + float(i)) / 4.0);
      float kBelow = clamp(uWarpStrength, 0.0, 1.0);
      float kMix = pow(kBelow, 0.3);
      float gain = 1.0 + max(uWarpStrength - 1.0, 0.0);
      vec2 disp = (r - s) * kBelow;
      vec2 warped = s + disp * gain;
      float m1 = length(warped + sin(5.0 * warped.y * uFrequency - 3.0 * t + float(i)) / 4.0);
      float m = mix(m0, m1, kMix);
      float w = 1.0 - exp(-6.0 / exp(6.0 * m));
      sumCol += uColors[i] * w;
      cover = max(cover, w);
    }
    col = clamp(sumCol, 0.0, 1.0);
    a = uTransparent > 0 ? cover : 1.0;
  } else {
    vec2 s = q;
    for (int k = 0; k < 3; ++k) {
      s -= 0.01;
      vec2 r = sin(1.5 * (s.yx * uFrequency) + 2.0 * cos(s * uFrequency));
      float m0 = length(r + sin(5.0 * r.y * uFrequency - 3.0 * t + float(k)) / 4.0);
      float kBelow = clamp(uWarpStrength, 0.0, 1.0);
      float kMix = pow(kBelow, 0.3);
      float gain = 1.0 + max(uWarpStrength - 1.0, 0.0);
      vec2 disp = (r - s) * kBelow;
      vec2 warped = s + disp * gain;
      float m1 = length(warped + sin(5.0 * warped.y * uFrequency - 3.0 * t + float(k)) / 4.0);
      float m = mix(m0, m1, kMix);
      col[k] = 1.0 - exp(-6.0 / exp(6.0 * m));
    }
    a = uTransparent > 0 ? max(max(col.r, col.g), col.b) : 1.0;
  }

  if (uNoise > 0.0001) {
    float n = fract(sin(dot(gl_FragCoord.xy + vec2(uTime), vec2(12.9898, 78.233))) * 43758.5453123);
    col += (n - 0.5) * uNoise;
    col = clamp(col, 0.0, 1.0);
  }

  vec3 rgb = (uTransparent > 0) ? col * a : col;
  gl_FragColor = vec4(rgb, a);
}`;

(function initColorBends() {
    const canvas = document.getElementById('cb-canvas');
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true })
             || canvas.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: true });
    if (!gl) return;

    function compileShader(type, src) {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            console.error('Shader error:', gl.getShaderInfoLog(sh));
        }
        return sh;
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, compileShader(gl.VERTEX_SHADER, CB_VERT));
    gl.attachShader(prog, compileShader(gl.FRAGMENT_SHADER, CB_FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    // Full-screen quad: positions and UVs
    const positions = new Float32Array([-1,-1,0,  1,-1,0,  -1,1,0,  1,1,0]);
    const uvs       = new Float32Array([0,0, 1,0, 0,1, 1,1]);

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(prog, 'aPosition');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);

    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    const uvLoc = gl.getAttribLocation(prog, 'aUv');
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);

    // Uniform locations
    const U = {
        canvas:         gl.getUniformLocation(prog, 'uCanvas'),
        time:           gl.getUniformLocation(prog, 'uTime'),
        speed:          gl.getUniformLocation(prog, 'uSpeed'),
        rot:            gl.getUniformLocation(prog, 'uRot'),
        rotSpeed:       gl.getUniformLocation(prog, 'uRotSpeed'),
        colorCount:     gl.getUniformLocation(prog, 'uColorCount'),
        colors:         gl.getUniformLocation(prog, 'uColors[0]'),
        transparent:    gl.getUniformLocation(prog, 'uTransparent'),
        scale:          gl.getUniformLocation(prog, 'uScale'),
        frequency:      gl.getUniformLocation(prog, 'uFrequency'),
        warpStrength:   gl.getUniformLocation(prog, 'uWarpStrength'),
        pointer:        gl.getUniformLocation(prog, 'uPointer'),
        mouseInfluence: gl.getUniformLocation(prog, 'uMouseInfluence'),
        parallax:       gl.getUniformLocation(prog, 'uParallax'),
        noise:          gl.getUniformLocation(prog, 'uNoise'),
    };

    // Set static uniforms
    gl.uniform1f(U.speed, 0.2);
    gl.uniform1f(U.rotSpeed, 0.05);
    gl.uniform1i(U.transparent, 0);
    gl.uniform1f(U.scale, 1.0);
    gl.uniform1f(U.frequency, 1.0);
    gl.uniform1f(U.warpStrength, 1.0);
    gl.uniform1f(U.mouseInfluence, 1.0);
    gl.uniform1f(U.parallax, 0.5);
    gl.uniform1f(U.noise, 0.05);
    gl.uniform2f(U.pointer, 0, 0);
    gl.uniform2f(U.rot, 1, 0);

    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);

    // Color state
    let flatColors = new Float32Array(MAX_COLORS * 3);
    let colorCount = 0;

    function hexToRgb(hex) {
        const h = hex.replace('#','').trim();
        const parse = s => parseInt(s, 16) / 255;
        if (h.length === 3) return [parse(h[0]+h[0]), parse(h[1]+h[1]), parse(h[2]+h[2])];
        return [parse(h.slice(0,2)), parse(h.slice(2,4)), parse(h.slice(4,6))];
    }

    window._cbSetColors = function(colors) {
        const arr = (colors || []).filter(Boolean).slice(0, MAX_COLORS);
        colorCount = arr.length;
        for (let i = 0; i < MAX_COLORS; i++) {
            const rgb = i < arr.length ? hexToRgb(arr[i]) : [0,0,0];
            flatColors[i*3] = rgb[0]; flatColors[i*3+1] = rgb[1]; flatColors[i*3+2] = rgb[2];
        }
    };

    window._cbSetRotationSpeed = function(speed) {
        gl.uniform1f(U.rotSpeed, speed);
    };

    function resize() {
        const w = window.innerWidth, h = window.innerHeight;
        canvas.width = w; canvas.height = h;
        gl.viewport(0, 0, w, h);
        gl.uniform2f(U.canvas, w, h);
    }
    resize();
    window.addEventListener('resize', resize);

    const pointerTarget  = [0,0];
    const pointerCurrent = [0,0];
    window.addEventListener('pointermove', e => {
        pointerTarget[0] = (e.clientX / window.innerWidth)  * 2 - 1;
        pointerTarget[1] = -((e.clientY / window.innerHeight) * 2 - 1);
    });

    let startTime = performance.now();
    let lastDt = 0;
    let frequencyCycle = 0;

    function loop() {
        const now = performance.now();
        const dt = (now - (lastDt || now)) / 1000;
        lastDt = now;
        const elapsed = (now - startTime) / 1000;

        frequencyCycle += dt * 0.2;
        const frequency = 1.1 + Math.sin(frequencyCycle) * 0.2;

        const lerpK = Math.min(1, dt * 8);
        pointerCurrent[0] += (pointerTarget[0] - pointerCurrent[0]) * lerpK;
        pointerCurrent[1] += (pointerTarget[1] - pointerCurrent[1]) * lerpK;

        gl.useProgram(prog);
        gl.uniform1f(U.time, elapsed);
        gl.uniform2f(U.pointer, pointerCurrent[0], pointerCurrent[1]);
        gl.uniform1i(U.colorCount, colorCount);
        gl.uniform3fv(U.colors, flatColors);
        gl.uniform1f(U.frequency, frequency);

        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        requestAnimationFrame(loop);
    }
    loop();
})();

// ============================================================
//  BLOB TRACKER CLASS
// ============================================================
const randomColors = ['#ffffff','#D4A017','#FF7D00','#00B4D8','#FF0054','#00FF88'];
const gaussianKernel = [0.06136, 0.24477, 0.38774, 0.24477, 0.06136];
const kernelRadius = 2;
const BASE_STYLES_LIST = ['base','label','frame','lframe','xframe','grid','dash','scope','win2k','label2','glow','reference'];
const DX8 = new Int8Array([-1, 0, 1, -1, 1, -1, 0, 1]);
const DY8 = new Int8Array([-1, -1, -1,  0, 0,  1, 1, 1]);

class BlobTracker {
    constructor(video, canvas) {
        this.video = video;
        this.canvas = canvas;
        this.canvas.width = BASE_WIDTH;
        this.canvas.height = BASE_HEIGHT;
        this.ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });

        this.sourceCanvas = document.createElement('canvas');
        this.sourceCanvas.width = BASE_WIDTH; this.sourceCanvas.height = BASE_HEIGHT;
        this.sourceCtx = this.sourceCanvas.getContext('2d', { willReadFrequently: true, alpha: false });

        this.maskCanvas = document.createElement('canvas');
        this.maskCanvas.width = BASE_WIDTH; this.maskCanvas.height = BASE_HEIGHT;
        this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true, alpha: false });

        this.filterTempCanvas = document.createElement('canvas');
        this.filterTempCanvas.width = 512; this.filterTempCanvas.height = 512;
        this.filterTempCtx = this.filterTempCanvas.getContext('2d', { willReadFrequently: true, alpha: false });

        this.tempDisplayCanvas = document.createElement('canvas');
        this.tempDisplayCanvas.width = BASE_WIDTH; this.tempDisplayCanvas.height = BASE_HEIGHT;
        this.tempDisplayCtx = this.tempDisplayCanvas.getContext('2d', { alpha: false });

        this.ctx.imageSmoothingEnabled = true; this.ctx.imageSmoothingQuality = 'high';
        this.sourceCtx.imageSmoothingEnabled = true; this.sourceCtx.imageSmoothingQuality = 'high';

        this.isRunning = false; this.isCamera = false; this.stream = null;
        this.blobs = []; this.frameCount = 0;
        this.animationFrameId = null; this.videoFrameCallbackId = null;
        this.isExporting = false; this.exportAbort = false;
        this._downgradeToastMsg = null;

        this.prevFrameGray      = new Uint8Array(BASE_WIDTH * BASE_HEIGHT);
        this.currentGray        = new Uint8Array(BASE_WIDTH * BASE_HEIGHT);
        this.blurredGray        = new Uint8Array(BASE_WIDTH * BASE_HEIGHT);
        this.motionMask         = new Uint8Array(BASE_WIDTH * BASE_HEIGHT);
        this.finalMask          = new Uint8Array(BASE_WIDTH * BASE_HEIGHT);
        this.gaussianTempBuffer = new Uint8Array(BASE_WIDTH * BASE_HEIGHT);
        this.morphTempBuffer    = new Uint8Array(BASE_WIDTH * BASE_HEIGHT);
        this.bfsQueueX          = new Uint16Array(BASE_WIDTH * BASE_HEIGHT);
        this.bfsQueueY          = new Uint16Array(BASE_WIDTH * BASE_HEIGHT);
        this.visitedBuffer      = new Uint8Array(BASE_WIDTH * BASE_HEIGHT);

        this.videoDrawX = 0; this.videoDrawY = 0;
        this.videoDrawW = BASE_WIDTH; this.videoDrawH = BASE_HEIGHT;
        this.prevBlobs = [];
        this.originalVideoWidth  = BASE_WIDTH;
        this.originalVideoHeight = BASE_HEIGHT;
        this.originalVideoFps    = 30;
        this.originalVideoDuration = 0;

        this.onProgress    = () => {};
        this.onToast       = () => {};
        this.onStateChange = () => {};
        this.onVideoLoad   = null;

        this.mainLoop = this.mainLoop.bind(this);

        // ★ 高帧率解耦渲染：跟踪计算 30fps 固定，视频渲染全帧率
        this.lastTrackTime      = 0;       // 上次跟踪帧开始的时间戳（用于插值）
        this._lastRafTs         = 0;       // RAF 降级路径的 60fps 节流时间戳
        this._trackTimerId      = null;    // setTimeout handle：跟踪计算独立定时器
        this.trackInterval      = 1000/30; // 跟踪帧间隔：固定 30fps
        this.prevTrackBlobs     = [];      // 上一个跟踪帧的 blob 数据
        this.currentTrackBlobs  = [];      // 当前跟踪帧的 blob 数据
        this.interpRatio        = 0;       // 两个跟踪帧之间的插值比例 [0..1]

        // ★ 连线决策状态：30fps 生成，渲染循环只读取不生成，避免 60fps 随机闪烁
        this.linkDecisions      = {         // 存储连线决策结果
            centerHubLinks: [],             // centerHub 模式：每个 blob 是否连线的布尔数组
            blobPairLinks: []               // 非 centerHub 模式：blob 对之间的连线决策
        };

        // ★ 闪线决策状态：30fps 生成，渲染循环只读取不生成，避免 60fps 高频闪烁
        this.flashLineDecisions = {         // 存储闪线决策结果
            enabled: false,                 // 当前帧是否启用闪线
            lines: []                       // 每条闪线的位置信息 {ry}
        };
    }

    computeVideoLayout(videoW, videoH) {
        if (!videoW || !videoH || videoW <= 0 || videoH <= 0) {
            this.videoDrawX = 0; this.videoDrawY = 0; this.videoDrawW = BASE_WIDTH; this.videoDrawH = BASE_HEIGHT; return;
        }
        const va = videoW / videoH, ca = BASE_WIDTH / BASE_HEIGHT;
        if (Math.abs(va - ca) < 0.02) {
            this.videoDrawX = 0; this.videoDrawY = 0; this.videoDrawW = BASE_WIDTH; this.videoDrawH = BASE_HEIGHT;
        } else if (va > ca) {
            this.videoDrawW = BASE_WIDTH; this.videoDrawH = Math.round(BASE_WIDTH / va);
            this.videoDrawX = 0; this.videoDrawY = Math.round((BASE_HEIGHT - this.videoDrawH) / 2);
        } else {
            this.videoDrawH = BASE_HEIGHT; this.videoDrawW = Math.round(BASE_HEIGHT * va);
            this.videoDrawX = Math.round((BASE_WIDTH - this.videoDrawW) / 2); this.videoDrawY = 0;
        }
    }

    // ══════════════════════════════════════════════════════════════════
    //  帧率检测系统（完全重写，彻底修复高帧率视频低估问题）
    //
    //  根本原因分析：
    //  ① RAF采样方法用 16x 速，1秒媒体时间在 62ms 内结束，只有 ~3 个 RAF 回调
    //    → fc≈3 → 返回 3fps，与真实帧率完全无关
    //  ② rVFC 用 2x 速：60fps 视频每个 rVFC 回调跨 2 帧 → interval=1/30s → 30fps
    //    1x 才能使 rVFC 的 interval 精准等于 1/真实fps
    //  ③ MP4 parser 只读前 5MB：大文件的 moov 在末尾，findBox 返回 null → 漏过
    //
    //  修复策略：
    //  ① _parseMp4Fps：读前 8MB + 后 12MB，优先用 timescale/sample_delta（精确到1帧）
    //  ② _getVideoFpsViaRVFC：强制 1x 播放，确保 interval = 1/fps，90帧采样，10s 超时
    //  ③ _getVideoFpsBySampling：改为 1x+实时钟，计数 rVFC 回调数/真实秒数，彻底废弃 16x
    // ══════════════════════════════════════════════════════════════════
    async getVideoFps(file, isHighRes = false) {
        // ── 方法①：MP4 box 二进制解析（零播放延迟，最精准） ──
        if (file && /\.(mp4|m4v|mov)$/i.test(file.name)) {
            try {
                const fps = await this._parseMp4Fps(file);
                if (fps >= 1 && fps <= 300) {
                    console.log('[FPS] ✅ MP4 box 解析 →', fps, 'fps');
                    return Math.round(fps * 100) / 100;
                }
            } catch(e) { console.warn('[FPS] MP4 box 解析失败:', e); }
        }

        // ── 方法②：requestVideoFrameCallback（始终 1x 速，mediaTime interval 中位数） ──
        if (this.video.requestVideoFrameCallback) {
            try {
                const fps = await this._getVideoFpsViaRVFC();
                if (fps >= 1 && fps <= 300) {
                    console.log('[FPS] ✅ rVFC 检测 →', fps, 'fps');
                    return Math.round(fps * 100) / 100;
                }
            } catch(e) { console.warn('[FPS] rVFC 失败:', e); }
        }

        // ── 方法③：实时钟帧计数（1x 速，彻底废弃 16x） ──
        try {
            const fps = await this._getVideoFpsBySampling();
            if (fps >= 1 && fps <= 300) {
                console.log('[FPS] ✅ 实时采样 →', fps, 'fps');
                return fps;
            }
        } catch(e) { console.warn('[FPS] 实时采样失败:', e); }

        console.warn('[FPS] 所有方法失败，默认 30fps');
        return 30;
    }

    // ── 方法①实现：MP4 box 二进制解析 ──────────────────────────────────────
    // 关键修复：读前 8MB + 后 12MB，覆盖 moov 在文件末尾的常见情况
    // 优先使用 timescale/sample_delta（直接除法，最精准）
    async _parseMp4Fps(file) {
        // 先尝试前 8MB（fast-start / 流式 MP4，moov 在开头）
        const FRONT = Math.min(file.size, 8_000_000);
        const frontBuf = await file.slice(0, FRONT).arrayBuffer();
        const fromFront = this._parseMp4FpsFromBuf(frontBuf);
        if (fromFront > 0) {
            console.log('[FPS] moov 位置: 文件头部');
            return fromFront;
        }

        // 再尝试后 12MB（标准 MP4，moov 在末尾）
        if (file.size > FRONT) {
            const BACK = Math.min(file.size, 12_000_000);
            const backStart = file.size - BACK;
            const backBuf = await file.slice(backStart).arrayBuffer();
            const fromBack = this._parseMp4FpsFromBuf(backBuf);
            if (fromBack > 0) {
                console.log('[FPS] moov 位置: 文件尾部（非 fast-start）');
                return fromBack;
            }
        }
        return 0;
    }

    _parseMp4FpsFromBuf(buf) {
        const dv = new DataView(buf);
        const len = buf.byteLength;

        const findBox = (offset, end, name) => {
            let pos = offset;
            while (pos + 8 <= end) {
                let sz = dv.getUint32(pos);
                // 处理 extended size (64-bit)
                if (sz === 1 && pos + 16 <= end) sz = Number(dv.getBigUint64(pos + 8));
                const n = String.fromCharCode(
                    dv.getUint8(pos+4), dv.getUint8(pos+5),
                    dv.getUint8(pos+6), dv.getUint8(pos+7)
                );
                if (n === name) return { start: pos, end: Math.min(pos + sz, end) };
                if (sz < 8 || sz > end - pos) break;
                pos += sz;
            }
            return null;
        };

        try {
            const moov = findBox(0, len, 'moov');
            if (!moov) return 0;

            // 遍历所有 trak，找视频轨
            let trakOffset = moov.start + 8;
            while (trakOffset < moov.end) {
                const trak = findBox(trakOffset, moov.end, 'trak');
                if (!trak) break;
                trakOffset = trak.end;

                // 检查是否是视频轨 (hdlr type = 'vide')
                const mdia = findBox(trak.start+8, trak.end, 'mdia');
                if (!mdia) continue;

                const hdlr = findBox(mdia.start+8, mdia.end, 'hdlr');
                if (hdlr) {
                    const ho = hdlr.start + 8;
                    const handlerType = String.fromCharCode(
                        dv.getUint8(ho+8), dv.getUint8(ho+9),
                        dv.getUint8(ho+10), dv.getUint8(ho+11)
                    );
                    if (handlerType !== 'vide') continue;
                }

                const mdhd = findBox(mdia.start+8, mdia.end, 'mdhd');
                if (!mdhd) continue;
                const o = mdhd.start + 8;
                const ver = dv.getUint8(o);
                const timescale = dv.getUint32(o + (ver === 1 ? 20 : 12));
                if (!timescale || timescale < 1) continue;

                const minf = findBox(mdia.start+8, mdia.end, 'minf');
                if (!minf) continue;
                const stbl = findBox(minf.start+8, minf.end, 'stbl');
                if (!stbl) continue;
                const stts = findBox(stbl.start+8, stbl.end, 'stts');
                if (!stts) continue;

                const so = stts.start + 8;
                const entryCount = dv.getUint32(so + 4);
                if (entryCount === 0) continue;

                // ★ 优先：timescale / sample_delta（最直接，精确到 1/timescale fps）
                //   stts entry: [sample_count(4)] [sample_delta(4)]
                const firstDelta = dv.getUint32(so + 12);
                if (firstDelta > 0) {
                    const fps = timescale / firstDelta;
                    if (fps >= 1 && fps <= 300) return fps;
                }

                // 备用：totalSamples / (mdhd_duration / timescale)
                const mdhdDuration = ver === 1
                    ? (Number(dv.getBigUint64(o + 24)))
                    : dv.getUint32(o + 16);
                if (mdhdDuration > 0) {
                    let totalSamples = 0;
                    for (let i = 0; i < Math.min(entryCount, 8); i++) {
                        totalSamples += dv.getUint32(so + 8 + i*8);
                    }
                    if (totalSamples > 0) {
                        const fps = totalSamples / (mdhdDuration / timescale);
                        if (fps >= 1 && fps <= 300) return fps;
                    }
                }
            }
        } catch(e) {
            console.warn('[FPS] box 内部解析异常:', e);
        }
        return 0;
    }

    // ── 方法②实现：rVFC 中位数法（强制 1x 速，消除倍速导致的帧合并失真）────
    // 关键修复：playbackRate 固定为 1，interval = 1/真实fps，无失真
    async _getVideoFpsViaRVFC() {
        return new Promise((resolve, reject) => {
            const SAMPLE_FRAMES = 90;   // 覆盖 30/60/90/120fps 各至少 1 秒
            const intervals     = [];
            let prevMediaTime   = null;
            let frameCount      = 0;
            let settled         = false;

            const snapToStandard = (rawFps) => {
                // 吸附到标准帧率（容差 ±1.5fps，覆盖 NTSC 分数帧率）
                const STD = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 119.88, 120, 144, 240];
                for (const s of STD) {
                    if (Math.abs(rawFps - s) <= 1.5) return s;
                }
                return Math.round(rawFps * 100) / 100;
            };

            const finish = (rawFps) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                this.video.pause();
                this.video.currentTime = 0;
                this.video.playbackRate = 1;
                resolve(snapToStandard(rawFps));
            };

            const onFrame = (now, metadata) => {
                if (settled) return;
                const mt = metadata.mediaTime;
                if (prevMediaTime !== null && mt > prevMediaTime) {
                    intervals.push(mt - prevMediaTime);
                }
                prevMediaTime = mt;
                frameCount++;

                if (frameCount >= SAMPLE_FRAMES && intervals.length >= 10) {
                    // 去掉最高/最低各 10% 后取中位数（抗抖动）
                    const sorted = intervals.slice().sort((a, b) => a - b);
                    const trim   = Math.floor(sorted.length * 0.1);
                    const core   = sorted.slice(trim, sorted.length - trim);
                    const mid    = core[Math.floor(core.length / 2)];
                    if (mid > 0 && mid < 1) { finish(1 / mid); return; }
                }
                this.video.requestVideoFrameCallback(onFrame);
            };

            // 10s 超时兜底（高码率 4K 视频解码启动慢）
            const timeout = setTimeout(() => {
                if (intervals.length >= 6) {
                    const sorted = intervals.slice().sort((a, b) => a - b);
                    const mid    = sorted[Math.floor(sorted.length / 2)];
                    if (mid > 0 && mid < 1) { finish(1 / mid); return; }
                }
                reject(new Error('rVFC 超时'));
            }, 10000);

            this.video.requestVideoFrameCallback(onFrame);
            this.video.currentTime = 0;
            // ★★★ 关键修复：始终 1x 速 ★★★
            // 2x/4x 会导致每个 rVFC 回调跨越多个视频帧，interval 虚大 → fps 虚低
            // 1x 保证每次回调恰好是一个视频帧的 mediaTime 差值
            this.video.playbackRate = 1;
            this.video.play().catch(() => { clearTimeout(timeout); reject(new Error('play 失败')); });
        });
    }

    // ── 方法③实现：实时钟帧计数（废弃 16x，改用 1x + rVFC 计数）────────────
    // 关键修复：用真实挂钟时间 2 秒内的 rVFC 回调数 / 实际秒数 = fps
    // 不再受播放倍速影响，彻底消除 "3fps" 错误结果
    async _getVideoFpsBySampling() {
        return new Promise((resolve) => {
            let frameCount  = 0;
            let startWallMs = -1;
            const WALL_MS   = 2500;   // 实测 2.5 秒真实时间
            let settled     = false;

            const finish = (fps) => {
                if (settled) return;
                settled = true;
                this.video.pause();
                this.video.currentTime = 0;
                this.video.playbackRate = 1;
                // 吸附到标准帧率（同 rVFC 方法）
                const STD = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 120, 144, 240];
                for (const s of STD) {
                    if (Math.abs(fps - s) <= 3) { resolve(s); return; }
                }
                resolve(Math.max(1, Math.round(fps)));
            };

            const wallTimeout = setTimeout(() => {
                if (startWallMs >= 0 && frameCount > 5) {
                    const elapsed = (performance.now() - startWallMs) / 1000;
                    finish(frameCount / elapsed);
                } else {
                    resolve(30);
                }
            }, WALL_MS + 1000);

            // ★ 用 rVFC 精准计数（优先）
            if (this.video.requestVideoFrameCallback) {
                const countFrame = (wallNow) => {
                    if (settled) return;
                    if (startWallMs < 0) startWallMs = wallNow;
                    frameCount++;
                    const elapsed = wallNow - startWallMs;
                    if (elapsed >= WALL_MS) {
                        clearTimeout(wallTimeout);
                        finish(frameCount / (elapsed / 1000));
                        return;
                    }
                    this.video.requestVideoFrameCallback(countFrame);
                };
                this.video.requestVideoFrameCallback(countFrame);
            } else {
                // 降级：currentTime 变化计数（精度略低但不会出 3fps）
                const poll = () => {
                    if (settled) return;
                    if (startWallMs < 0) startWallMs = performance.now();
                    frameCount++;
                    const elapsed = performance.now() - startWallMs;
                    if (elapsed >= WALL_MS) {
                        clearTimeout(wallTimeout);
                        finish(frameCount / (elapsed / 1000));
                    } else {
                        requestAnimationFrame(poll);
                    }
                };
                requestAnimationFrame(poll);
            }

            this.video.currentTime = 0;
            // ★ 1x 速，实时钟计数，无倍速失真
            this.video.playbackRate = 1;
            this.video.play().catch(() => { clearTimeout(wallTimeout); resolve(30); });
        });
    }
    resetVideo() {
        this.isRunning = false; this.isCamera = false;
        if (this.animationFrameId) { cancelAnimationFrame(this.animationFrameId); this.animationFrameId = null; }
        if (this.videoFrameCallbackId && this.video.cancelVideoFrameCallback) {
            this.video.cancelVideoFrameCallback(this.videoFrameCallbackId); this.videoFrameCallbackId = null;
        }
        if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
        this.exportAbort = true;
        this.video.pause(); this.video.src = ''; this.video.srcObject = null;
        this.blobs = []; this.prevBlobs = []; this.frameCount = 0;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.sourceCtx.clearRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
        this.originalVideoDuration = 0;
        this.videoDrawX = 0; this.videoDrawY = 0; this.videoDrawW = BASE_WIDTH; this.videoDrawH = BASE_HEIGHT;
        // ★ 重置解耦渲染状态，防止残留 blob 数据影响下一个视频
        this.lastTrackTime     = 0;
        this._lastRafTs        = 0;
        this.prevTrackBlobs    = [];
        this.currentTrackBlobs = [];
        this.interpRatio       = 0;
        if (this._trackTimerId !== null) { clearTimeout(this._trackTimerId); this._trackTimerId = null; }
        this.onProgress(0, 0, 0); this.onStateChange(false);
    }

    // ★ 等待 loadedmetadata + canplaythrough 双事件后再读取元数据，确保参数完整准确
    async loadVideo(file) {
        this.resetVideo();
        const url = URL.createObjectURL(file);
        this.video.preload = 'auto';
        this.video.src = url;

        // 添加 blob URL 加载的错误处理
        this.video.addEventListener('error', (e) => {
            console.warn('视频加载错误:', e);
            // 不要立即撤销 URL，可能需要重试
        });

        // ── 阶段1：等待视频元数据就绪 (loadedmetadata) ──
        await new Promise((resolve, reject) => {
            const onMeta = () => { cleanup(); resolve(); };
            const onErr  = () => { cleanup(); URL.revokeObjectURL(url); this.resetVideo(); reject(new Error('load error')); };
            const cleanup = () => {
                this.video.removeEventListener('loadedmetadata', onMeta);
                this.video.removeEventListener('error', onErr);
            };
            if (this.video.readyState >= 1) { resolve(); return; }
            this.video.addEventListener('loadedmetadata', onMeta);
            this.video.addEventListener('error', onErr);
        });

        // ── 阶段2：等待足够数据可播放 (canplaythrough)，确保 duration 准确 ──
        await new Promise((resolve) => {
            const onReady = () => { cleanup(); resolve(); };
            const cleanup = () => {
                this.video.removeEventListener('canplaythrough', onReady);
                clearTimeout(t);
            };
            if (this.video.readyState >= 4) { resolve(); return; }
            this.video.addEventListener('canplaythrough', onReady);
            const t = setTimeout(onReady, 3000);
        });

        // ── 阶段3：读取准确的视频元参数 ──
        this.originalVideoWidth    = this.video.videoWidth  || BASE_WIDTH;
        this.originalVideoHeight   = this.video.videoHeight || BASE_HEIGHT;
        this.originalVideoDuration = this.video.duration;

        // ── 阶段4：精准帧率检测（三级降级策略）──
        // 超规格视频（4K+）使用1x速度采样，最低80帧，确保精准识别
        // ★ 帧率检测现在始终用 1x 速，isHighRes 仅用于日志记录
        const isHighRes = (this.originalVideoWidth >= 3840 || this.originalVideoHeight >= 2160);
        console.log('[FPS] 高分辨率模式:', isHighRes, '| 分辨率:', this.originalVideoWidth + 'x' + this.originalVideoHeight);
        this.originalVideoFps = await this.getVideoFps(file, isHighRes);

        // 计算总帧数用于调试与导出校验
        const totalFrames = Math.floor(this.originalVideoDuration * this.originalVideoFps);

        // ── 控制台输出调试信息 ──
        console.log('═══════════════════════════════════════════');
        console.log('[BlobTracker] 视频元数据识别完成');
        console.log('[BlobTracker]   真实帧率:', this.originalVideoFps, 'fps');
        console.log('[BlobTracker]   总时长  :', this.originalVideoDuration.toFixed(4), 's');
        console.log('[BlobTracker]   计算总帧:', totalFrames, '帧');
        console.log('[BlobTracker]   分辨率  :', this.originalVideoWidth, 'x', this.originalVideoHeight);
        console.log('═══════════════════════════════════════════');

        // ── 阶段5：白名单校验 ──
        // 白名单档位1：≤4K且帧率≤30fps
        // 白名单档位2：≤1080P且帧率≤60fps
        const w = this.originalVideoWidth, h = this.originalVideoHeight, fps = this.originalVideoFps;
        const is4KOrLess   = (w <= 3840 && h <= 2160);
        const is1080POrLess = (w <= 1920 && h <= 1080);
        // ±0.5fps 容差：消除帧率检测噪声导致的误判（如 4K 视频检测为 30.1fps 时不应弹窗）
        const inWhitelist  = (is4KOrLess && fps <= 30.5) || (is1080POrLess && fps <= 60.5);

        console.log('[BlobTracker] 白名单校验:', inWhitelist ? '✅ 正常规格，直接加载' : '⚠️ 超规格视频，弹窗选择');
        console.log('[BlobTracker]   is4KOrLess:', is4KOrLess, '| is1080POrLess:', is1080POrLess, '| fps<=30.5:', fps<=30.5, '| fps<=60.5:', fps<=60.5);

        if (!inWhitelist) {
            // 超规格：弹窗阻塞，等待用户选择
            const choice = await window._showOverspecModal(w, h, fps);
            console.log('[BlobTracker] 用户选择:', choice);

            if (choice === 'cancel') {
                // ★ 取消导入 — 严格按规格 §Task3-Button3 执行：
                //   ① 释放 ObjectURL 防止内存泄漏
                //   ② 显式清空 file-input（防止下次点击同一文件不触发 change 事件）
                //   ③ resetVideo() 清空所有帧缓冲区、追踪数据，恢复初始状态
                //   ④ Toast 提示用户
                URL.revokeObjectURL(url);
                const _fileInput = document.getElementById('file-input');
                if (_fileInput) _fileInput.value = '';
                this.resetVideo();
                this.onToast('已取消视频导入');
                return;
            }

            // 降级参数
            let capW, capH, capFps, skipFramesHint;
            if (choice === '4k30') {
                capW = 3840; capH = 2160; capFps = 30;
                // 4K30：跳帧2（每3帧处理1帧），平衡性能
                skipFramesHint = 2;
                this._downgradeToastMsg = '已自动降级为 4K30帧，性能已适配优化';
            } else {
                capW = 1920; capH = 1080; capFps = 60;
                // 1080P60：跳帧1（每2帧处理1帧），保证流畅
                skipFramesHint = 1;
                this._downgradeToastMsg = '已自动降级为 1080P60帧，性能已适配优化';
            }

            // 应用降级：锁定分辨率和帧率上限
            this.originalVideoWidth  = Math.min(w, capW);
            this.originalVideoHeight = Math.min(h, capH);
            this.originalVideoFps    = Math.min(fps, capFps);
            // 保持宽高比
            if (w > capW || h > capH) {
                const scaleW = capW / w, scaleH = capH / h;
                const scale  = Math.min(scaleW, scaleH);
                this.originalVideoWidth  = Math.round(w * scale);
                this.originalVideoHeight = Math.round(h * scale);
            }
            // 自主适配跳帧参数（不强制，只是建议值 — 不覆盖用户设置，仅在用户未自定义时生效）
            if (trackerConfig.skipFrames <= 1) {
                trackerConfig.skipFrames = skipFramesHint;
                // 同步 UI 滑块
                const sl = document.getElementById('sl-skipFrames');
                if (sl) {
                    sl.value = skipFramesHint;
                    const vEl = document.getElementById('val-skipFrames');
                    if (vEl) vEl.textContent = skipFramesHint;
                    if (typeof updateSliderStyle === 'function') updateSliderStyle(sl);
                }
            }

            console.log('[BlobTracker] 降级参数应用:',
                this.originalVideoWidth + 'x' + this.originalVideoHeight,
                '@ ' + this.originalVideoFps + 'fps',
                '跳帧=' + trackerConfig.skipFrames);
        }

        // ── 阶段6：初始化画布与背景帧（原有阶段5逻辑，完全不变）──
        this.computeVideoLayout(this.video.videoWidth, this.video.videoHeight);
        if (this.onVideoLoad) this.onVideoLoad(this.video.videoWidth / this.video.videoHeight);

        const fpsDisplay = (Math.round(this.originalVideoFps * 100) / 100).toFixed(2);
        // ★ 降级流程优先显示降级消息，正常流程显示标准加载信息
        if (this._downgradeToastMsg) {
            this.onToast(this._downgradeToastMsg);
            this._downgradeToastMsg = null;
        } else {
            this.onToast(
                `视频已加载 | ${this.originalVideoWidth}×${this.originalVideoHeight} | ` +
                `${fpsDisplay}fps | ${this.formatTime(this.originalVideoDuration)}`
            );
        }

        this.sourceCtx.clearRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
        this.sourceCtx.drawImage(this.video, this.videoDrawX, this.videoDrawY, this.videoDrawW, this.videoDrawH);
        this.canvas.width  = this.videoDrawW;
        this.canvas.height = this.videoDrawH;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(
            this.sourceCanvas,
            this.videoDrawX, this.videoDrawY, this.videoDrawW, this.videoDrawH,
            0, 0, this.videoDrawW, this.videoDrawH
        );
        const initFrame = this.sourceCtx.getImageData(0, 0, BASE_WIDTH, BASE_HEIGHT);
        this.getGrayData(initFrame, this.currentGray);
        this.fastGaussianBlur(this.currentGray, this.blurredGray, this.gaussianTempBuffer, BASE_WIDTH, BASE_HEIGHT);
        this.prevFrameGray.set(this.blurredGray);
    }

    async startCamera() {
        try {
            this.resetVideo(); this.isCamera = true;
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { width:{ideal:BASE_WIDTH}, height:{ideal:BASE_HEIGHT}, facingMode:'user' }, audio: false
            });
            this.video.srcObject = this.stream;
            return new Promise(resolve => {
                this.video.onloadedmetadata = () => {
                    this.video.play();
                    this.computeVideoLayout(this.video.videoWidth||BASE_WIDTH, this.video.videoHeight||BASE_HEIGHT);
                    if (this.onVideoLoad) this.onVideoLoad((this.video.videoWidth||BASE_WIDTH)/(this.video.videoHeight||BASE_HEIGHT));
                    this.onToast('Camera started!');
                    this.sourceCtx.clearRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
                    this.sourceCtx.drawImage(this.video, this.videoDrawX, this.videoDrawY, this.videoDrawW, this.videoDrawH);
                    this.canvas.width = this.videoDrawW; this.canvas.height = this.videoDrawH;
                    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                    this.ctx.drawImage(this.sourceCanvas, this.videoDrawX, this.videoDrawY, this.videoDrawW, this.videoDrawH, 0, 0, this.videoDrawW, this.videoDrawH);
                    const f = this.sourceCtx.getImageData(0, 0, BASE_WIDTH, BASE_HEIGHT);
                    this.getGrayData(f, this.currentGray);
                    this.fastGaussianBlur(this.currentGray, this.blurredGray, this.gaussianTempBuffer, BASE_WIDTH, BASE_HEIGHT);
                    this.prevFrameGray.set(this.blurredGray);
                    resolve();
                };
            });
        } catch(e) { this.onToast('Camera permission denied.'); this.resetVideo(); }
    }

    toggleRun() {
        this.isRunning = !this.isRunning;
        this.onStateChange(this.isRunning);
        if (this.isRunning) {
            this.prevBlobs         = [];
            this.lastTrackTime     = 0;
            this.prevTrackBlobs    = [];
            this.currentTrackBlobs = [];
            this.interpRatio       = 0;
            if (!this.isCamera) {
                this.video.currentTime = 0;
                this.video.playbackRate = trackerConfig.speed;
                this.video.play().catch(() => this.onToast('Video playback failed'));
            }
            // ★ 先启动跟踪计算循环（独立 setTimeout，不阻塞渲染）
            this._trackLoop();
            // ★ 再启动渲染循环（rVFC/RAF，纯绘制，不含任何计算）
            this.mainLoop();
        } else {
            if (!this.isCamera) this.video.pause();
            // 停止渲染循环
            if (this.videoFrameCallbackId && this.video.cancelVideoFrameCallback) {
                this.video.cancelVideoFrameCallback(this.videoFrameCallbackId); this.videoFrameCallbackId = null;
            }
            if (this.animationFrameId) { cancelAnimationFrame(this.animationFrameId); this.animationFrameId = null; }
            // 停止跟踪计算循环
            if (this._trackTimerId !== null) { clearTimeout(this._trackTimerId); this._trackTimerId = null; }
        }
    }

    // ════════════════════════════════════════════════════════════════
    //  渲染循环 (mainLoop) — rVFC 驱动，纯绘制，绝对不执行任何跟踪计算
    //
    //  核心修复原理：
    //  旧架构：rVFC → updateBlobs(20-40ms) + drawFrame → 有效帧率 ≈ 15fps
    //  新架构：rVFC → 纯绘制(<1ms) ← 两路完全解耦，渲染永不被计算阻塞
    //          setTimeout → updateBlobs() 独立 30fps 循环
    //
    //  结果：视频以原生帧率(30/60fps)流畅渲染，跟踪框通过插值平滑跟随
    // ════════════════════════════════════════════════════════════════
    mainLoop() {
        if (!this.isRunning) return;
        this.frameCount++;
        const now = performance.now();

        // ── 渲染视频帧（<0.5ms GPU 操作，绝对不阻塞 rVFC）──────────────
        if (this.canvas.width !== this.videoDrawW || this.canvas.height !== this.videoDrawH) {
            this.canvas.width  = this.videoDrawW;
            this.canvas.height = this.videoDrawH;
        }
        const cw = this.canvas.width, ch = this.canvas.height;
        this.ctx.clearRect(0, 0, cw, ch);

        const filters = this.filters;
        if (trackerConfig.invertFilter && trackerConfig.filter !== 'none') {
            // invertFilter 模式：sourceCanvas 由 _trackLoop 更新（最多 33ms 旧，视觉无感）
            // 裁剪视频内容区 (videoDrawX,Y,W,H) → 输出 (0,0,cw,ch)，保留宽高比
            const fullFrame = this.sourceCtx.getImageData(0, 0, BASE_WIDTH, BASE_HEIGHT);
            filters[trackerConfig.filter](fullFrame, this.frameCount);
            this.maskCtx.putImageData(fullFrame, 0, 0);
            this.ctx.drawImage(this.maskCanvas,
                this.videoDrawX, this.videoDrawY, this.videoDrawW, this.videoDrawH,
                0, 0, cw, ch);
        } else {
            // 普通模式：直接渲染视频到 canvas，canvas 已设置为正确宽高比
            this.ctx.drawImage(this.video, 0, 0, cw, ch);
        }
        if (trackerConfig.invert && (this.isCamera || this.originalVideoDuration)) {
            const fd = this.ctx.getImageData(0, 0, cw, ch);
            filters.invert(fd);
            this.ctx.putImageData(fd, 0, 0);
        }

        // ── 计算插值比例（基于 _trackLoop 的时间戳，实时平滑过渡）────────
        const elapsed   = now - this.lastTrackTime;
        const t         = this.trackInterval > 0 ? Math.min(1, elapsed / this.trackInterval) : 1;
        const renderBlobs = this._getInterpolatedBlobs(this.prevTrackBlobs, this.currentTrackBlobs, t);

        // ── 绘制跟踪叠加层（全帧率，使用插值后的 blob 坐标）──────────────
        this._drawLiveOverlay(this.ctx, cw, ch, renderBlobs, this.frameCount);

        if (!this.isCamera && this.video.duration && isFinite(this.video.duration)) {
            this.onProgress((this.video.currentTime/this.video.duration)*100, this.video.currentTime, this.video.duration);
        }

        // ── 调度下一渲染帧 ────────────────────────────────────────────────
        if (this.video.requestVideoFrameCallback) {
            // rVFC：与视频帧精准同步，天然匹配视频原生帧率（30/60/120fps）
            this.videoFrameCallbackId = this.video.requestVideoFrameCallback(this.mainLoop);
        } else {
            // RAF 降级：60fps 上限，避免高刷屏无效重绘
            const self = this;
            this.animationFrameId = requestAnimationFrame(function rafCallback(ts) {
                if (!self.isRunning) return;
                if (!self._lastRafTs) self._lastRafTs = ts;
                if (ts - self._lastRafTs >= 1000/60 - 1) {
                    self._lastRafTs = ts;
                    self.mainLoop();
                } else {
                    self.animationFrameId = requestAnimationFrame(rafCallback);
                }
            });
        }
    }

    // ════════════════════════════════════════════════════════════════
    //  跟踪计算循环 (_trackLoop) — setTimeout 驱动，独立于渲染循环
    //
    //  设计原则：
    //  • 在本次计算完成后，用剩余时间 (trackInterval - elapsed) 调度下次执行
    //    → 自适应补偿：即使 updateBlobs() 耗时不均，整体仍保持 ~30fps
    //  • 完全不碰 canvas / ctx，不涉及任何绘制
    //  • 更新 prevTrackBlobs / currentTrackBlobs / lastTrackTime 供渲染循环读取
    // ════════════════════════════════════════════════════════════════
    _trackLoop() {
        if (!this.isRunning) return;
        const t0 = performance.now();

        // 执行完整跟踪计算（Gaussian blur + 背景差分 + BFS + 时间域平滑）
        this.updateBlobs();

        // 更新插值状态：上一帧 → 当前帧，渲染循环用来做平滑过渡
        this.prevTrackBlobs    = this.currentTrackBlobs.length > 0
            ? this.currentTrackBlobs
            : this.blobs.slice();
        this.currentTrackBlobs = this.blobs.slice();
        this.lastTrackTime     = performance.now();  // 本帧计算完成时间，用于 interpRatio 基准

        // 自适应调度：扣除本次计算耗时，尽量维持 trackInterval 节奏
        const elapsed = performance.now() - t0;
        const delay   = Math.max(0, this.trackInterval - elapsed);
        this._trackTimerId = setTimeout(() => this._trackLoop(), delay);
    }

    // ────────────────────────────────────────────────────────────────
    // 辅助方法：blob 位置/大小线性插值（消除 30fps 计算帧之间的视觉跳变）
    // ────────────────────────────────────────────────────────────────
    _getInterpolatedBlobs(prev, curr, t) {
        if (prev.length === 0 || curr.length === 0) return curr;
        if (t <= 0) return prev;
        if (t >= 1) return curr;

        const result = [];
        const used   = new Uint8Array(curr.length);

        for (let i = 0; i < prev.length; i++) {
            const p = prev[i];
            let bestIdx  = -1;
            let bestDist = Infinity;
            for (let j = 0; j < curr.length; j++) {
                if (used[j]) continue;
                const d = Math.hypot(p.x - curr[j].x, p.y - curr[j].y);
                if (d < bestDist && d < Math.max(p.size, curr[j].size) * 0.85) {
                    bestDist = d; bestIdx = j;
                }
            }
            if (bestIdx >= 0) {
                const c = curr[bestIdx];
                used[bestIdx] = 1;
                result.push({
                    ...c,
                    x:    p.x    + (c.x    - p.x)    * t,
                    y:    p.y    + (c.y    - p.y)    * t,
                    size: p.size + (c.size - p.size) * t
                });
            } else {
                result.push(p);
            }
        }
        for (let j = 0; j < curr.length; j++) {
            if (!used[j]) result.push(curr[j]);
        }
        return result;
    }

    // ────────────────────────────────────────────────────────────────
    // 辅助方法：仅绘制跟踪叠加层（不含背景，背景由 mainLoop 步骤1负责）
    // 与 drawFrameToTarget 的 overlay 部分完全对等，支持所有滤镜/边框/特效
    // ────────────────────────────────────────────────────────────────
    _drawLiveOverlay(ctx, cw, ch, blobs, fc) {
        const scaleX = cw / BASE_WIDTH, scaleY = ch / BASE_HEIGHT;
        const scale  = Math.min(scaleX, scaleY);
        const filters = this.filters;

        ctx.globalAlpha    = trackerConfig.blend ? 0.7 : 1;
        ctx.strokeStyle    = trackerConfig.mainColor;
        ctx.lineWidth      = trackerConfig.strokeWidth;
        ctx.fillStyle      = trackerConfig.mainColor;
        ctx.font           = `${trackerConfig.fontWeight} ${trackerConfig.fontSize}px ${trackerConfig.fontFamily}`;
        ctx.textAlign      = 'center';
        ctx.textBaseline   = 'middle';

        for (let bi = 0; bi < blobs.length; bi++) {
            const blob = blobs[bi];
            const x    = blob.x * scaleX, y = blob.y * scaleY;
            const size = blob.size * scale, half = size / 2;
            const boxX = Math.floor(x - half), boxY = Math.floor(y - half);
            const color = (trackerConfig.separateColor || trackerConfig.crazy) ? blob.color : trackerConfig.mainColor;

            // 局部滤镜：从缓存的 sourceCanvas 读取像素（30fps 频率，视觉无感知）
            const srcX  = Math.max(0, Math.floor(blob.x - blob.size / 2));
            const srcY  = Math.max(0, Math.floor(blob.y - blob.size / 2));
            const srcW  = Math.min(Math.ceil(blob.size), BASE_WIDTH  - srcX);
            const srcH  = Math.min(Math.ceil(blob.size), BASE_HEIGHT - srcY);
            const activeFilter = trackerConfig.randomFilter ? (blob.filter || trackerConfig.filter) : trackerConfig.filter;

            if (!trackerConfig.invertFilter && activeFilter !== 'none' && srcW > 0 && srcH > 0) {
                const boxFrame = this.sourceCtx.getImageData(srcX, srcY, srcW, srcH);
                filters[activeFilter](boxFrame, fc);
                if (trackerConfig.innerInvert) filters.invert(boxFrame);
                this.drawFilteredRegionClipped(ctx, boxFrame, x, y, half, boxX, boxY, size, trackerConfig.shape);
            } else if (trackerConfig.invertFilter && srcW > 0 && srcH > 0 && (activeFilter !== 'none' || trackerConfig.innerInvert)) {
                const boxFrame = this.sourceCtx.getImageData(srcX, srcY, srcW, srcH);
                if (trackerConfig.innerInvert) filters.invert(boxFrame);
                this.drawFilteredRegionClipped(ctx, boxFrame, x, y, half, boxX, boxY, size, trackerConfig.shape);
            }

            // ★ 使用 30fps 生成的闪线决策，避免 60fps 渲染循环中 Math.random() 导致的高频闪烁
            if (trackerConfig.flashLine && fc % 2 === 0 && this.flashLineDecisions.enabled) {
                const blobFlashLines = this.flashLineDecisions.lines[bi];
                if (blobFlashLines && blobFlashLines.length > 0) {
                    ctx.save();
                    this.applyShapeClip(ctx, trackerConfig.shape, x, y, half, boxX, boxY, size);
                    for (let i = 0; i < blobFlashLines.length; i++) {
                        const ry = boxY + blobFlashLines[i] * size; // 使用预生成的相对位置
                        ctx.fillStyle = '#ffffff'; ctx.fillRect(boxX, ry, size, 1);
                        ctx.fillStyle = '#000000'; ctx.fillRect(boxX, ry + 2, size, 1);
                    }
                    ctx.restore();
                }
            }

            ctx.strokeStyle = color;
            const activeStyle = trackerConfig.randomRegion ? (blob.style || trackerConfig.baseStyle) : trackerConfig.baseStyle;
            this.drawBaseStyleToTarget(blob, color, ctx, size, x, y, boxX, boxY, activeStyle, fc);

            ctx.fillStyle = trackerConfig.textColor;
            if (activeStyle === 'reference') {
                const normalizedSize = blob.size / BASE_WIDTH;
                const dimensionText = normalizedSize.toFixed(4);
                ctx.textAlign = 'center';
                ctx.fillText(dimensionText, x, boxY - 10);
                ctx.textAlign = 'right';
                ctx.save();
                ctx.translate(boxX - 10, y);
                ctx.rotate(-Math.PI / 2);
                ctx.fillText(dimensionText, 0, 0);
                ctx.restore();
            } else {
                const text = trackerConfig.textContent || blob.value;
                if (trackerConfig.textPosition === 'top')    ctx.fillText(text, x, boxY + 18);
                if (trackerConfig.textPosition === 'center') ctx.fillText(text, x, y);
                if (trackerConfig.textPosition === 'bottom') ctx.fillText(text, x, boxY + size - 8);
            }

            if (activeStyle !== 'reference') {
                ctx.fillStyle = color;
                ctx.beginPath(); ctx.arc(x, y, trackerConfig.dotSize, 0, Math.PI * 2); ctx.fill();
            }
        }

        ctx.globalAlpha  = 0.6;
        ctx.strokeStyle  = trackerConfig.lineColor;
        ctx.lineWidth    = trackerConfig.strokeWidth * 0.7;
        if      (trackerConfig.lineStyle === 'dashed')  ctx.setLineDash([5, 5]);
        else if (trackerConfig.lineStyle === 'dotted')  ctx.setLineDash([2, 2]);
        else if (trackerConfig.lineStyle === 'dashdot') ctx.setLineDash([5, 2, 2, 2]);
        else                                             ctx.setLineDash([]);

        // ★ 使用 30fps 预生成的连线决策，避免 60fps 渲染循环中 Math.random() 导致的闪烁
        const decisions = this.linkDecisions;
        if (trackerConfig.centerHub) {
            const hx = cw / 2, hy = ch / 2;
            for (let i = 0; i < blobs.length; i++) {
                if (decisions.centerHubLinks[i]) {
                    ctx.beginPath(); ctx.moveTo(hx, hy);
                    ctx.lineTo(blobs[i].x * scaleX, blobs[i].y * scaleY); ctx.stroke();
                }
            }
        } else {
            for (const link of decisions.blobPairLinks) {
                if (link.shouldLink) {
                    ctx.beginPath();
                    ctx.moveTo(blobs[link.i].x * scaleX, blobs[link.i].y * scaleY);
                    ctx.lineTo(blobs[link.j].x * scaleX, blobs[link.j].y * scaleY); ctx.stroke();
                }
            }
        }
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
        ctx.fillStyle   = trackerConfig.mainColor;
    }

    // ---- Filters ----
    get filters() {
        return {
            none: () => {},
            invert: (imgData) => {
                const d = imgData.data;
                for (let i = 0; i < d.length; i += 4) { d[i]=255-d[i]; d[i+1]=255-d[i+1]; d[i+2]=255-d[i+2]; }
            },
            glitch: (imgData, fc) => {
                const d = imgData.data, w = imgData.width, h = imgData.height;
                const temp = new Uint8Array(d);
                const time = (fc||0) * 0.22;
                const moveSpeed = 0.5;
                const numBlocks = 4;
                const bh = Math.floor(h/3.5);
                const spacing = h/(numBlocks+1);
                for (let b = 0; b < numBlocks; b++) {
                    const blockSeed = (b*9973) & 0xFFFF;
                    const baseYFrac = (b+1)*spacing/h;
                    const moveOffset = -((fc||0) * moveSpeed) % h;
                    const byFrac = (baseYFrac + moveOffset/h + 1) % 1;
                    const by = Math.floor(byFrac*h);
                    const maxOff = Math.floor(w*(0.15+(blockSeed&7)/80));
                    const sign = (blockSeed&1)?1:-1;
                    const offset = sign*Math.floor(maxOff*(0.4+0.3*Math.abs(Math.sin(by*0.02+time*0.3))));
                    if (offset === 0) continue;
                    const chSep = 4+(blockSeed&3)*2;
                    let y2 = Math.min(by+bh,h);
                    if (y2 < 0) continue;
                    let y1 = Math.max(0, by);
                    for (let y = y1; y < y2; y++) {
                        for (let x = 0; x < w; x++) {
                            const srcX  = Math.max(0,Math.min(w-1,x+offset));
                            const srcXr = Math.max(0,Math.min(w-1,srcX+chSep));
                            const srcXb = Math.max(0,Math.min(w-1,srcX-chSep));
                            const di=(y*w+x)*4;
                            d[di]  =temp[(y*w+srcXr)*4];
                            d[di+1]=temp[(y*w+srcX)*4+1];
                            d[di+2]=temp[(y*w+srcXb)*4+2];
                        }
                    }
                }
            },
            thermal: (imgData, fc) => {
                const d = imgData.data, time = (fc || 0) * 0.05;
                const waveShift = Math.sin(time * 0.7) * 0.15;
                const waveShift2 = Math.cos(time * 0.5) * 0.1;
                for (let i = 0; i < d.length; i += 4) {
                    const luma = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
                    const shiftedLuma = Math.max(0, Math.min(1, luma + waveShift + waveShift2));
                    let r, g, b;
                    if (shiftedLuma < 0.125) {
                        const t = shiftedLuma / 0.125;
                        r = 0; g = 0; b = Math.round(t * 160);
                    } else if (shiftedLuma < 0.25) {
                        const t = (shiftedLuma - 0.125) / 0.125;
                        r = 0; g = Math.round(t * 200); b = 255;
                    } else if (shiftedLuma < 0.375) {
                        const t = (shiftedLuma - 0.25) / 0.125;
                        r = 0; g = 255; b = Math.round(255 * (1 - t));
                    } else if (shiftedLuma < 0.5) {
                        const t = (shiftedLuma - 0.375) / 0.125;
                        r = Math.round(t * 200); g = 255; b = 0;
                    } else if (shiftedLuma < 0.625) {
                        const t = (shiftedLuma - 0.5) / 0.125;
                        r = 255; g = Math.round(255 * (1 - t * 0.4)); b = 0;
                    } else if (shiftedLuma < 0.75) {
                        const t = (shiftedLuma - 0.625) / 0.125;
                        r = 255; g = Math.round(153 * (1 - t)); b = 0;
                    } else if (shiftedLuma < 0.875) {
                        const t = (shiftedLuma - 0.75) / 0.125;
                        r = 255; g = Math.round(t * 180); b = Math.round(t * 80);
                    } else {
                        const t = (shiftedLuma - 0.875) / 0.125;
                        r = 255; g = Math.round(180 + t * 75); b = Math.round(80 + t * 175);
                    }
                    d[i] = r; d[i + 1] = g; d[i + 2] = b;
                }
            },
            pixel: (imgData) => {
                const d=imgData.data,w=imgData.width,h=imgData.height,bs=8;
                for (let y=0;y<h;y+=bs) for (let x=0;x<w;x+=bs) {
                    const idx=((y+bs/2|0)*w+(x+bs/2|0))*4;
                    const r=d[idx],g=d[idx+1],b=d[idx+2];
                    for (let dy=0;dy<bs&&y+dy<h;dy++) for (let dx=0;dx<bs&&x+dx<w;dx++) {
                        const n=((y+dy)*w+(x+dx))*4; d[n]=r;d[n+1]=g;d[n+2]=b;
                    }
                }
            },
            tone: (imgData) => {
                const d=imgData.data;
                for (let i=0;i<d.length;i+=4){d[i]=Math.min(255,d[i]*0.85);d[i+1]=Math.min(255,d[i+1]*1.15);d[i+2]=Math.min(255,d[i+2]*0.9);}
            },
            blur: (imgData) => {
                const d=imgData.data,w=imgData.width,h=imgData.height;
                const temp=new Uint8Array(d);const r=3;
                for (let y=r;y<h-r;y++) for (let x=r;x<w-r;x++) {
                    let rv=0,gv=0,bv=0,cnt=0;
                    for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++) {
                        const idx=((y+dy)*w+(x+dx))*4;rv+=temp[idx];gv+=temp[idx+1];bv+=temp[idx+2];cnt++;
                    }
                    const idx=(y*w+x)*4;d[idx]=rv/cnt;d[idx+1]=gv/cnt;d[idx+2]=bv/cnt;
                }
            },
            dither: (imgData) => {
                const d=imgData.data,w=imgData.width,h=imgData.height;
                for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
                    const idx=(y*w+x)*4;
                    const gray=(d[idx]*0.299+d[idx+1]*0.587+d[idx+2]*0.114)|0;
                    const val=gray>128?255:0;const err=gray-val;
                    d[idx]=d[idx+1]=d[idx+2]=val;
                    if (x<w-1){const n=(y*w+x+1)*4;d[n]=Math.min(255,d[n]+err*7/16);d[n+1]=Math.min(255,d[n+1]+err*7/16);d[n+2]=Math.min(255,d[n+2]+err*7/16);}
                    if (y<h-1){
                        if (x>0){const n=((y+1)*w+x-1)*4;d[n]=Math.min(255,d[n]+err*3/16);d[n+1]=Math.min(255,d[n+1]+err*3/16);d[n+2]=Math.min(255,d[n+2]+err*3/16);}
                        const n=((y+1)*w+x)*4;d[n]=Math.min(255,d[n]+err*5/16);d[n+1]=Math.min(255,d[n+1]+err*5/16);d[n+2]=Math.min(255,d[n+2]+err*5/16);
                        if (x<w-1){const n=((y+1)*w+x+1)*4;d[n]=Math.min(255,d[n]+err*1/16);d[n+1]=Math.min(255,d[n+1]+err*1/16);d[n+2]=Math.min(255,d[n+2]+err*1/16);}
                    }
                }
            },
            zoom: (imgData) => {
                const d=imgData.data,w=imgData.width,h=imgData.height;
                const temp=new Uint8Array(d);const scale=1.2,cx=w/2,cy=h/2;
                for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
                    const sx=cx+(x-cx)/scale,sy=cy+(y-cy)/scale;
                    if (sx>=0&&sx<w&&sy>=0&&sy<h){const idx=(y*w+x)*4,si=(Math.floor(sy)*w+Math.floor(sx))*4;d[idx]=temp[si];d[idx+1]=temp[si+1];d[idx+2]=temp[si+2];}
                }
            },
            xray: (imgData) => {
                const d=imgData.data;
                for (let i=0;i<d.length;i+=4){const g=(d[i]+d[i+1]+d[i+2])/3;d[i]=Math.min(255,g*0.2);d[i+1]=Math.min(255,g*0.9);d[i+2]=Math.min(255,g*0.9);}
            },
            water: (imgData, fc) => {
                const d=imgData.data,w=imgData.width,h=imgData.height;
                const temp=new Uint8Array(d);const time=(fc||0)*0.09;const ax=12,ay=8,freq=0.048;
                for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
                    const ox=Math.round(Math.sin(y*freq+time)*ax+Math.sin(x*freq*0.6+time*1.4)*ax*0.45);
                    const oy=Math.round(Math.cos(x*freq+time)*ay+Math.cos(y*freq*0.7+time*0.85)*ay*0.45);
                    const sx=Math.max(0,Math.min(w-1,x+ox));const sy=Math.max(0,Math.min(h-1,y+oy));
                    const si=(sy*w+sx)*4,di=(y*w+x)*4;d[di]=temp[si];d[di+1]=temp[si+1];d[di+2]=temp[si+2];
                }
            },
            mask: (imgData) => {
                const d=imgData.data,w=imgData.width,h=imgData.height;const cx=w/2,cy=h/2,maxD=Math.min(cx,cy);
                for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
                    const a=Math.max(0,1-Math.hypot(x-cx,y-cy)/maxD);const idx=(y*w+x)*4;d[idx]*=a;d[idx+1]*=a;d[idx+2]*=a;
                }
            },
            crt: (imgData, fc) => {
                const d=imgData.data,w=imgData.width,h=imgData.height;const temp=new Uint8Array(d);const scanI=0.3,bend=0.02;
                for (let y=0;y<h;y++) {
                    const sc=y%3===0?1-scanI:1,ny=(y/h)*2-1;
                    for (let x=0;x<w;x++) {
                        const nx=(x/w)*2-1;
                        const sx=Math.max(0,Math.min(w-1,x+nx*bend*w));const sy=Math.max(0,Math.min(h-1,y+ny*bend*h));
                        const si=(Math.floor(sy)*w+Math.floor(sx))*4,di=(y*w+x)*4;
                        d[di]=temp[si]*sc;d[di+1]=temp[(Math.floor(sy)*w+Math.max(0,Math.floor(sx)-1))*4+1]*sc;
                        d[di+2]=temp[(Math.floor(sy)*w+Math.min(w-1,Math.floor(sx)+1))*4+2]*sc;
                    }
                }
                if (Math.random()>0.9) for (let i=0;i<d.length;i+=4*Math.floor(w*0.1)) d[i]=d[i+1]=d[i+2]=255;
            },
            edge: (imgData) => {
                const d=imgData.data,w=imgData.width,h=imgData.height;const gray=new Float32Array(w*h);
                for (let i=0;i<d.length;i+=4) gray[i/4]=(d[i]+d[i+1]+d[i+2])/3;
                for (let y=1;y<h-1;y++) for (let x=1;x<w-1;x++) {
                    const idx=y*w+x;
                    const gx=-gray[idx-w-1]+gray[idx-w+1]-2*gray[idx-1]+2*gray[idx+1]-gray[idx+w-1]+gray[idx+w+1];
                    const gy=-gray[idx-w-1]-2*gray[idx-w]-gray[idx-w+1]+gray[idx+w-1]+2*gray[idx+w]+gray[idx+w+1];
                    const mag=Math.sqrt(gx*gx+gy*gy)>40?255:0;const di=idx*4;d[di]=d[di+1]=d[di+2]=mag;
                }
            }
        };
    }

    // ---- Tracking Logic ----
    getGrayData(imgData, outBuffer) {
        const d = imgData.data;
        for (let i = 0; i < BASE_WIDTH*BASE_HEIGHT; i++) {
            const idx = i*4;
            outBuffer[i] = (d[idx]*299+d[idx+1]*587+d[idx+2]*114)/1000|0;
        }
    }

    fastGaussianBlur(gray, outBuffer, tempBuffer, w, h) {
        for (let y=0;y<h;y++) {
            const row=y*w;
            for (let x=0;x<w;x++) {
                let sum=0;
                for (let k=-kernelRadius;k<=kernelRadius;k++) {
                    const nx=x+k<0?0:x+k>=w?w-1:x+k;
                    sum+=gray[row+nx]*gaussianKernel[k+kernelRadius];
                }
                tempBuffer[row+x]=sum|0;
            }
        }
        for (let x=0;x<w;x++) {
            for (let y=0;y<h;y++) {
                let sum=0;
                for (let k=-kernelRadius;k<=kernelRadius;k++) {
                    const ny=y+k<0?0:y+k>=h?h-1:y+k;
                    sum+=tempBuffer[ny*w+x]*gaussianKernel[k+kernelRadius];
                }
                outBuffer[y*w+x]=sum|0;
            }
        }
    }

    backgroundSubtractionStrided(cur, pre, threshold, outBuffer, w, h, stride) {
        if (stride <= 1) {
            for (let i=0,n=w*h;i<n;i++) outBuffer[i]=Math.abs(cur[i]-pre[i])>threshold?255:0;
            return;
        }
        for (let y=0;y<h;y+=stride) {
            const y2=Math.min(y+stride,h);
            for (let x=0;x<w;x+=stride) {
                const val=Math.abs(cur[y*w+x]-pre[y*w+x])>threshold?255:0;
                const x2=Math.min(x+stride,w);
                for (let fy=y;fy<y2;fy++){const row=fy*w;for (let fx=x;fx<x2;fx++) outBuffer[row+fx]=val;}
            }
        }
    }

    fastDilate(mask, outBuffer, w, h, r) {
        for (let y=0;y<h;y++) {
            const row=y*w; let cnt=0;
            for (let x=0;x<Math.min(r,w);x++) if (mask[row+x]===255) cnt++;
            for (let x=0;x<w;x++) {
                if (x+r<w&&mask[row+x+r]===255) cnt++;
                this.morphTempBuffer[row+x]=cnt>0?255:0;
                if (x-r>=0&&mask[row+x-r]===255) cnt--;
            }
        }
        for (let x=0;x<w;x++) {
            let cnt=0;
            for (let y=0;y<Math.min(r,h);y++) if (this.morphTempBuffer[y*w+x]===255) cnt++;
            for (let y=0;y<h;y++) {
                if (y+r<h&&this.morphTempBuffer[(y+r)*w+x]===255) cnt++;
                outBuffer[y*w+x]=cnt>0?255:0;
                if (y-r>=0&&this.morphTempBuffer[(y-r)*w+x]===255) cnt--;
            }
        }
    }

    nmsBlobs(blobs) {
        if (blobs.length <= 1) return blobs;
        const suppressed=new Uint8Array(blobs.length); const result=[];
        for (let i=0;i<blobs.length;i++) {
            if (suppressed[i]) continue; result.push(blobs[i]);
            const bi=blobs[i];
            for (let j=i+1;j<blobs.length;j++) {
                if (suppressed[j]) continue;
                if (Math.hypot(bi.x-blobs[j].x,bi.y-blobs[j].y)<(bi.size+blobs[j].size)*0.35) suppressed[j]=1;
            }
        }
        return result;
    }

    smoothBlobs(newBlobs, prevBlobsArr, alpha, smoothAttributes = true) {
        if (prevBlobsArr.length === 0) return newBlobs;
        const used=new Uint8Array(prevBlobsArr.length); const result=[];
        for (let ni=0;ni<newBlobs.length;ni++) {
            const nb=newBlobs[ni]; let bestDist=Infinity,bestIdx=-1;
            for (let pi=0;pi<prevBlobsArr.length;pi++) {
                if (used[pi]) continue;
                const d=Math.hypot(nb.x-prevBlobsArr[pi].x,nb.y-prevBlobsArr[pi].y);
                if (d<bestDist){bestDist=d;bestIdx=pi;}
            }
            if (bestIdx>=0&&bestDist<Math.max(nb.size*2, 150)) {
                used[bestIdx]=1; const pb=prevBlobsArr[bestIdx];
                result.push({
                    x:pb.x+(nb.x-pb.x)*alpha, y:pb.y+(nb.y-pb.y)*alpha,
                    size:pb.size+(nb.size-pb.size)*alpha, area:nb.area, value:nb.value,
                    color: smoothAttributes ? (pb.color!==undefined?pb.color:nb.color) : nb.color,
                    style: smoothAttributes ? (pb.style!==undefined?pb.style:nb.style) : nb.style,
                    filter: smoothAttributes ? (pb.filter!==undefined?pb.filter:nb.filter) : nb.filter
                });
            } else { result.push(nb); }
        }
        return result;
    }

    findContours(mask, w, h) {
        this.visitedBuffer.fill(0); const result=[];
        const maxBlobsCount=trackerConfig.maxBlobs;
        const MIN_AREA=trackerConfig.minArea;
        const FILTER_LIST=['none','invert','glitch','thermal','pixel','tone','blur','dither','zoom','xray','water','mask','crt','edge'];
        for (let y=0;y<h&&result.length<maxBlobsCount;y++) {
            for (let x=0;x<w;x++) {
                const startIdx=y*w+x;
                if (mask[startIdx]<255||this.visitedBuffer[startIdx]) continue;
                let qHead=0,qTail=0;
                this.bfsQueueX[qTail]=x;this.bfsQueueY[qTail]=y;qTail++;
                this.visitedBuffer[startIdx]=1;
                let minX=x,maxX=x,minY=y,maxY=y,area=0;
                while (qHead<qTail) {
                    const px=this.bfsQueueX[qHead],py=this.bfsQueueY[qHead];qHead++;area++;
                    if (px<minX)minX=px;else if (px>maxX)maxX=px;
                    if (py<minY)minY=py;else if (py>maxY)maxY=py;
                    for (let d=0;d<8;d++) {
                        const nx=px+DX8[d],ny=py+DY8[d];
                        if (nx<0||ny<0||nx>=w||ny>=h) continue;
                        const nIdx=ny*w+nx;
                        if (!this.visitedBuffer[nIdx]&&mask[nIdx]===255){this.visitedBuffer[nIdx]=1;this.bfsQueueX[qTail]=nx;this.bfsQueueY[qTail]=ny;qTail++;}
                    }
                }
                if (area<MIN_AREA) continue;
                const bboxW=maxX-minX+1,bboxH=maxY-minY+1;
                if (Math.max(bboxW,bboxH)/Math.max(1,Math.min(bboxW,bboxH))>12) continue;
                const naturalSize=Math.max(bboxW,bboxH)*1.4;
                const blobSize=trackerConfig.sameSize?trackerConfig.boundingSize:Math.min(Math.max(naturalSize,30),trackerConfig.boundingSize*2);
                // ★ 用 blob 中心坐标做确定性哈希：相同位置 → 相同随机样式
                //   坐标量化：导出时使用更大步长，确保快速运动物体属性稳定
                //   实时预览：量化步长最小 50 像素，或等于 blob 尺寸
                //   视频导出：量化步长最小 150 像素，或等于 blob 尺寸的 3 倍
                const cx = (minX+maxX)/2, cy = (minY+maxY)/2;
                const quantStep = this.isExporting ? Math.max(150, blobSize * 3) : Math.max(50, blobSize);
                const qx = Math.floor(cx / quantStep), qy = Math.floor(cy / quantStep);
                const bSeed = ((qx * 2654435761 ^ qy * 40503) >>> 0);
                result.push({
                    x:(minX+maxX)/2, y:(minY+maxY)/2, area, size:blobSize,
                    value:((bSeed % 10000) / 100).toFixed(2),
                    color:trackerConfig.crazy?randomColors[bSeed % randomColors.length]:trackerConfig.mainColor,
                    style:trackerConfig.randomRegion?BASE_STYLES_LIST[bSeed % BASE_STYLES_LIST.length]:trackerConfig.baseStyle,
                    filter:trackerConfig.randomFilter?FILTER_LIST[bSeed % FILTER_LIST.length]:trackerConfig.filter
                });
                if (result.length>=maxBlobsCount) break;
            }
        }
        result.sort((a,b)=>b.area-a.area);
        return result.slice(0,maxBlobsCount);
    }

    updateBlobs() {
        this.sourceCtx.clearRect(0,0,BASE_WIDTH,BASE_HEIGHT);
        this.sourceCtx.drawImage(this.video,this.videoDrawX,this.videoDrawY,this.videoDrawW,this.videoDrawH);
        const frame=this.sourceCtx.getImageData(0,0,BASE_WIDTH,BASE_HEIGHT);
        this.getGrayData(frame,this.currentGray);
        if (trackerConfig.skipFrames<=2) this.fastGaussianBlur(this.currentGray,this.blurredGray,this.gaussianTempBuffer,BASE_WIDTH,BASE_HEIGHT);
        else this.blurredGray.set(this.currentGray);
        const motionThreshold=Math.max(5,trackerConfig.threshold*0.5);
        const stride=trackerConfig.skipFrames+1;
        this.backgroundSubtractionStrided(this.blurredGray,this.prevFrameGray,motionThreshold,this.motionMask,BASE_WIDTH,BASE_HEIGHT,stride);
        this.fastDilate(this.motionMask,this.finalMask,BASE_WIDTH,BASE_HEIGHT,3);
        const rawBlobs=this.findContours(this.finalMask,BASE_WIDTH,BASE_HEIGHT);
        const nmsResult=this.nmsBlobs(rawBlobs);
        const filtered=trackerConfig.singleTrack?nmsResult.slice(0,1):nmsResult;
        // ★ 导出时仍进行位置平滑，但属性使用确定性哈希（不继承上一帧属性）
        //   因为每帧独立 seek，prevBlobs 可能是其他帧的数据，所以属性不平滑
        //   但位置平滑可以改善抖动，提升导出视频质量
        if (this.isExporting) {
            this.blobs = this.smoothBlobs(filtered, this.prevBlobs, 0.4, false);
            this.prevBlobs = this.blobs.slice();
        } else {
            this.blobs = this.smoothBlobs(filtered, this.prevBlobs, 0.4, true);
            this.prevBlobs = this.blobs.slice();
        }
        this.prevFrameGray.set(this.blurredGray);

        // ★ 30fps 生成连线决策，避免 60fps 渲染循环中 Math.random() 导致的高频闪烁
        this._updateLinkDecisions();
    }

    // ★ 导出专用：与 updateBlobs 类似，但不更新 prevFrameGray
    // 因为导出时 prevFrameGray 已由外部循环精确控制（时序相邻帧）
    updateBlobsForExport() {
        this.sourceCtx.clearRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
        this.sourceCtx.drawImage(this.video, this.videoDrawX, this.videoDrawY, this.videoDrawW, this.videoDrawH);
        const frame = this.sourceCtx.getImageData(0, 0, BASE_WIDTH, BASE_HEIGHT);
        this.getGrayData(frame, this.currentGray);
        if (trackerConfig.skipFrames <= 2) this.fastGaussianBlur(this.currentGray, this.blurredGray, this.gaussianTempBuffer, BASE_WIDTH, BASE_HEIGHT);
        else this.blurredGray.set(this.currentGray);
        const motionThreshold = Math.max(5, trackerConfig.threshold * 0.5);
        const stride = trackerConfig.skipFrames + 1;
        this.backgroundSubtractionStrided(this.blurredGray, this.prevFrameGray, motionThreshold, this.motionMask, BASE_WIDTH, BASE_HEIGHT, stride);
        this.fastDilate(this.motionMask, this.finalMask, BASE_WIDTH, BASE_HEIGHT, 3);
        const rawBlobs = this.findContours(this.finalMask, BASE_WIDTH, BASE_HEIGHT);
        const nmsResult = this.nmsBlobs(rawBlobs);
        const filtered = trackerConfig.singleTrack ? nmsResult.slice(0, 1) : nmsResult;
        // 导出时跳过属性平滑，但进行位置平滑
        this.blobs = this.smoothBlobs(filtered, this.prevBlobs, 0.4, false);
        this.prevBlobs = this.blobs.slice();
        // 注意：不更新 prevFrameGray，由外部导出循环控制
    }

    // ★ 30fps 连线决策生成：在 updateBlobs 中调用，与渲染分离
    _updateLinkDecisions() {
        const blobs = this.blobs;
        const decisions = this.linkDecisions;

        if (trackerConfig.centerHub) {
            // centerHub 模式：为每个 blob 决定是否连线到中心
            decisions.centerHubLinks = new Array(blobs.length);
            for (let i = 0; i < blobs.length; i++) {
                decisions.centerHubLinks[i] = Math.random() < trackerConfig.linkRate;
            }
            decisions.blobPairLinks = [];
        } else {
            // 非 centerHub 模式：为每对 blob 决定是否连线
            const pairCount = (blobs.length * (blobs.length - 1)) / 2;
            decisions.blobPairLinks = new Array(pairCount);
            let idx = 0;
            for (let i = 0; i < blobs.length; i++) {
                for (let j = i + 1; j < blobs.length; j++) {
                    const shouldLink = Math.hypot(blobs[i].x - blobs[j].x, blobs[i].y - blobs[j].y) < trackerConfig.linkDist
                        && Math.random() < trackerConfig.linkRate;
                    decisions.blobPairLinks[idx++] = { i, j, shouldLink };
                }
            }
            decisions.centerHubLinks = [];
        }

        // ★ 30fps 闪线决策生成：避免 60fps 渲染循环中 Math.random() 导致的高频闪烁
        const flashDecisions = this.flashLineDecisions;
        if (trackerConfig.flashLine) {
            flashDecisions.enabled = true;
            flashDecisions.lines = new Array(blobs.length);
            for (let i = 0; i < blobs.length; i++) {
                // 为每个 blob 生成 2 条闪线的位置
                const blobLines = [];
                for (let j = 0; j < 2; j++) {
                    blobLines.push(Math.random()); // 存储 0-1 的相对位置，渲染时乘以 size
                }
                flashDecisions.lines[i] = blobLines;
            }
        } else {
            flashDecisions.enabled = false;
            flashDecisions.lines = [];
        }
    }

    applyShapeClip(targetCtx, shape, cx, cy, half, boxX, boxY, size) {
        targetCtx.beginPath();
        if (shape==='circle') {
            targetCtx.arc(cx,cy,half,0,Math.PI*2);
        } else if (shape==='diamond') {
            const rx=Math.floor(cx)+0.5,ry=Math.floor(cy)+0.5;
            targetCtx.moveTo(rx,boxY);targetCtx.lineTo(rx+half,ry);targetCtx.lineTo(rx,boxY+size);targetCtx.lineTo(rx-half,ry);targetCtx.closePath();
        } else {
            targetCtx.rect(boxX,boxY,size,size);
        }
        targetCtx.clip();
    }

    drawFilteredRegionClipped(targetCtx, imgData, cx, cy, half, boxX, boxY, size, shape) {
        const srcW=imgData.width,srcH=imgData.height;
        if (srcW<=0||srcH<=0) return;
        this.filterTempCtx.putImageData(imgData,0,0);
        targetCtx.save();
        this.applyShapeClip(targetCtx,shape,cx,cy,half,boxX,boxY,size);
        targetCtx.drawImage(this.filterTempCanvas,0,0,srcW,srcH,boxX,boxY,size,size);
        targetCtx.restore();
    }

    drawBaseStyleToTarget(blob, color, targetCtx, size, x, y, boxX, boxY, activeStyle, frameCount) {
        targetCtx.beginPath();
        const half=size/2, rx=Math.floor(x)+0.5, ry=Math.floor(y)+0.5, sh=trackerConfig.shape;
        switch(activeStyle) {
            case 'base': case 'frame':
                if      (sh==='square') targetCtx.rect(boxX,boxY,size,size);
                else if (sh==='circle') targetCtx.arc(rx,ry,half,0,Math.PI*2);
                else {targetCtx.moveTo(rx,boxY);targetCtx.lineTo(rx+half,ry);targetCtx.lineTo(rx,boxY+size);targetCtx.lineTo(rx-half,ry);targetCtx.closePath();}
                if (activeStyle==='frame') targetCtx.rect(boxX+3,boxY+3,size-6,size-6);
                break;
            case 'label':
                targetCtx.rect(boxX,boxY,size,size); targetCtx.fillStyle=color;
                targetCtx.fillRect(boxX,boxY-24,size,24); break;
            case 'lframe':
                const cornerLen = Math.max(15, size * 0.2);
                targetCtx.beginPath();
                targetCtx.moveTo(boxX, boxY + cornerLen);
                targetCtx.lineTo(boxX, boxY);
                targetCtx.lineTo(boxX + cornerLen, boxY);
                targetCtx.moveTo(boxX + size - cornerLen, boxY);
                targetCtx.lineTo(boxX + size, boxY);
                targetCtx.lineTo(boxX + size, boxY + cornerLen);
                targetCtx.moveTo(boxX + size, boxY + size - cornerLen);
                targetCtx.lineTo(boxX + size, boxY + size);
                targetCtx.lineTo(boxX + size - cornerLen, boxY + size);
                targetCtx.moveTo(boxX + cornerLen, boxY + size);
                targetCtx.lineTo(boxX, boxY + size);
                targetCtx.lineTo(boxX, boxY + size - cornerLen);
                break;
            case 'xframe':
                targetCtx.moveTo(boxX,boxY);targetCtx.lineTo(boxX+size,boxY+size);
                targetCtx.moveTo(boxX+size,boxY);targetCtx.lineTo(boxX,boxY+size); break;
            case 'grid':
                targetCtx.rect(boxX,boxY,size,size);
                targetCtx.moveTo(boxX+size/3,boxY);targetCtx.lineTo(boxX+size/3,boxY+size);
                targetCtx.moveTo(boxX+size*2/3,boxY);targetCtx.lineTo(boxX+size*2/3,boxY+size);
                targetCtx.moveTo(boxX,boxY+size/3);targetCtx.lineTo(boxX+size,boxY+size/3);
                targetCtx.moveTo(boxX,boxY+size*2/3);targetCtx.lineTo(boxX+size,boxY+size*2/3); break;
            case 'dash':
                targetCtx.setLineDash([6, 6]);
                if      (sh==='square') targetCtx.rect(boxX,boxY,size,size);
                else if (sh==='circle') targetCtx.arc(rx,ry,half,0,Math.PI*2);
                else {targetCtx.moveTo(rx,boxY);targetCtx.lineTo(rx+half,ry);targetCtx.lineTo(rx,boxY+size);targetCtx.lineTo(rx-half,ry);targetCtx.closePath();}
                targetCtx.stroke();
                targetCtx.setLineDash([]);
                return;
            case 'scope':
                targetCtx.arc(rx,ry,half,0,Math.PI*2);
                targetCtx.moveTo(boxX,ry);targetCtx.lineTo(boxX+size,ry);
                targetCtx.moveTo(rx,boxY);targetCtx.lineTo(rx,boxY+size); break;
            case 'win2k':
                targetCtx.rect(boxX,boxY,size,size);targetCtx.fillStyle=color;targetCtx.fillRect(boxX,boxY,size,24);
                targetCtx.fillStyle='#ffffff';targetCtx.fillRect(boxX+size-20,boxY+4,16,16);
                targetCtx.moveTo(boxX+size-16,boxY+8);targetCtx.lineTo(boxX+size-8,boxY+16);
                targetCtx.moveTo(boxX+size-8,boxY+8);targetCtx.lineTo(boxX+size-16,boxY+16); break;
            case 'label2':
                targetCtx.rect(boxX,boxY,size,size);targetCtx.fillStyle=`${color}40`;targetCtx.fillRect(boxX,boxY,size,size);
                targetCtx.fillStyle=color;targetCtx.fillRect(boxX,boxY-24,size,24); break;
            case 'glow':
                targetCtx.shadowColor=color;targetCtx.shadowBlur=12;
                if      (sh==='square') targetCtx.rect(boxX,boxY,size,size);
                else if (sh==='circle') targetCtx.arc(rx,ry,half,0,Math.PI*2);
                else {targetCtx.moveTo(rx,boxY);targetCtx.lineTo(rx+half,ry);targetCtx.lineTo(rx,boxY+size);targetCtx.lineTo(rx-half,ry);targetCtx.closePath();}
                targetCtx.stroke();targetCtx.shadowBlur=24;targetCtx.stroke();targetCtx.shadowBlur=0;return;
            case 'reference':
                targetCtx.rect(boxX, boxY, size, size);
                targetCtx.stroke();
                const cornerSize = Math.max(6, size * 0.08);
                targetCtx.beginPath();
                targetCtx.fillStyle = color;
                targetCtx.fillRect(boxX - cornerSize/2, boxY - cornerSize/2, cornerSize, cornerSize);
                targetCtx.fillRect(boxX + size - cornerSize/2, boxY - cornerSize/2, cornerSize, cornerSize);
                targetCtx.fillRect(boxX - cornerSize/2, boxY + size - cornerSize/2, cornerSize, cornerSize);
                targetCtx.fillRect(boxX + size - cornerSize/2, boxY + size - cornerSize/2, cornerSize, cornerSize);
                return;
        }
        targetCtx.stroke();
    }

    drawFrameToTarget(targetCtx, targetWidth, targetHeight, currentFrameCount) {
        if (currentFrameCount === undefined) currentFrameCount = this.frameCount;
        const scaleX=targetWidth/BASE_WIDTH, scaleY=targetHeight/BASE_HEIGHT, scale=Math.min(scaleX,scaleY);
        const filters = this.filters;

        if (trackerConfig.invertFilter && trackerConfig.filter !== 'none') {
            const fullFrame=this.sourceCtx.getImageData(0,0,BASE_WIDTH,BASE_HEIGHT);
            filters[trackerConfig.filter](fullFrame,currentFrameCount);
            this.maskCtx.putImageData(fullFrame,0,0);
            targetCtx.drawImage(this.maskCanvas,0,0,targetWidth,targetHeight);
        } else {
            targetCtx.drawImage(this.sourceCanvas,0,0,targetWidth,targetHeight);
        }

        if (trackerConfig.invert && (this.isCamera || this.originalVideoDuration)) {
            const fullFrame=targetCtx.getImageData(0,0,targetWidth,targetHeight);
            filters.invert(fullFrame); targetCtx.putImageData(fullFrame,0,0);
        }

        targetCtx.globalAlpha=trackerConfig.blend?0.7:1;
        targetCtx.strokeStyle=trackerConfig.mainColor;
        targetCtx.lineWidth=trackerConfig.strokeWidth;
        targetCtx.fillStyle=trackerConfig.mainColor;
        targetCtx.font=`${trackerConfig.fontWeight} ${trackerConfig.fontSize}px ${trackerConfig.fontFamily}`;
        targetCtx.textAlign='center'; targetCtx.textBaseline='middle';

        for (let bi=0;bi<this.blobs.length;bi++) {
            const blob=this.blobs[bi];
            const x=blob.x*scaleX,y=blob.y*scaleY,size=blob.size*scale,half=size/2;
            const boxX=Math.floor(x-half),boxY=Math.floor(y-half);
            const color=(trackerConfig.separateColor||trackerConfig.crazy)?blob.color:trackerConfig.mainColor;
            const srcX=Math.max(0,Math.floor(blob.x-blob.size/2));
            const srcY=Math.max(0,Math.floor(blob.y-blob.size/2));
            const srcW=Math.min(Math.ceil(blob.size),BASE_WIDTH-srcX);
            const srcH=Math.min(Math.ceil(blob.size),BASE_HEIGHT-srcY);
            const activeFilter=trackerConfig.randomFilter?(blob.filter||trackerConfig.filter):trackerConfig.filter;
            if (!trackerConfig.invertFilter&&activeFilter!=='none'&&srcW>0&&srcH>0) {
                const boxFrame=this.sourceCtx.getImageData(srcX,srcY,srcW,srcH);
                filters[activeFilter](boxFrame,currentFrameCount);
                if (trackerConfig.innerInvert) filters.invert(boxFrame);
                this.drawFilteredRegionClipped(targetCtx,boxFrame,x,y,half,boxX,boxY,size,trackerConfig.shape);
            } else if (trackerConfig.invertFilter&&srcW>0&&srcH>0&&(activeFilter!=='none'||trackerConfig.innerInvert)) {
                const boxFrame=this.sourceCtx.getImageData(srcX,srcY,srcW,srcH);
                if (trackerConfig.innerInvert) filters.invert(boxFrame);
                this.drawFilteredRegionClipped(targetCtx,boxFrame,x,y,half,boxX,boxY,size,trackerConfig.shape);
            }
            // ★ 使用预生成的闪线决策（导出时由 _updateLinkDecisions 生成，实时预览由 updateBlobs 生成）
            if (trackerConfig.flashLine && currentFrameCount % 2 === 0 && this.flashLineDecisions.enabled) {
                const blobFlashLines = this.flashLineDecisions.lines[bi];
                if (blobFlashLines && blobFlashLines.length > 0) {
                    targetCtx.save();
                    this.applyShapeClip(targetCtx, trackerConfig.shape, x, y, half, boxX, boxY, size);
                    for (let i = 0; i < blobFlashLines.length; i++) {
                        const ry = boxY + blobFlashLines[i] * size; // 使用预生成的相对位置
                        targetCtx.fillStyle = '#ffffff'; targetCtx.fillRect(boxX, ry, size, 1);
                        targetCtx.fillStyle = '#000000'; targetCtx.fillRect(boxX, ry + 2, size, 1);
                    }
                    targetCtx.restore();
                }
            }
            targetCtx.strokeStyle=color;
            const activeStyle=trackerConfig.randomRegion?(blob.style||trackerConfig.baseStyle):trackerConfig.baseStyle;
            this.drawBaseStyleToTarget(blob,color,targetCtx,size,x,y,boxX,boxY,activeStyle,currentFrameCount);
            targetCtx.fillStyle=trackerConfig.textColor;
            if (activeStyle === 'reference') {
                const normalizedSize = blob.size / BASE_WIDTH;
                const dimensionText = normalizedSize.toFixed(4);
                targetCtx.textAlign = 'center';
                targetCtx.fillText(dimensionText, x, boxY - 10);
                targetCtx.textAlign = 'right';
                targetCtx.save();
                targetCtx.translate(boxX - 10, y);
                targetCtx.rotate(-Math.PI / 2);
                targetCtx.fillText(dimensionText, 0, 0);
                targetCtx.restore();
            } else {
                const text=trackerConfig.textContent||blob.value;
                if (trackerConfig.textPosition==='top')    targetCtx.fillText(text,x,boxY+18);
                if (trackerConfig.textPosition==='center') targetCtx.fillText(text,x,y);
                if (trackerConfig.textPosition==='bottom') targetCtx.fillText(text,x,boxY+size-8);
            }

            if (activeStyle !== 'reference') {
                targetCtx.fillStyle=color;
                targetCtx.beginPath();targetCtx.arc(x,y,trackerConfig.dotSize,0,Math.PI*2);targetCtx.fill();
            }
        }

        targetCtx.globalAlpha=0.6;
        targetCtx.strokeStyle=trackerConfig.lineColor;
        targetCtx.lineWidth=trackerConfig.strokeWidth*0.7;
        if      (trackerConfig.lineStyle==='dashed')  targetCtx.setLineDash([5,5]);
        else if (trackerConfig.lineStyle==='dotted')  targetCtx.setLineDash([2,2]);
        else if (trackerConfig.lineStyle==='dashdot') targetCtx.setLineDash([5,2,2,2]);
        else                                           targetCtx.setLineDash([]);
        // ★ 使用预生成的连线决策（导出时由 _updateLinkDecisions 生成，实时预览由 updateBlobs 生成）
        const decisions = this.linkDecisions;
        if (trackerConfig.centerHub) {
            const hx=targetWidth/2,hy=targetHeight/2;
            for (let i=0;i<this.blobs.length;i++) {
                if (decisions.centerHubLinks[i]){targetCtx.beginPath();targetCtx.moveTo(hx,hy);targetCtx.lineTo(this.blobs[i].x*scaleX,this.blobs[i].y*scaleY);targetCtx.stroke();}
            }
        } else {
            for (const link of decisions.blobPairLinks) {
                if (link.shouldLink) {
                    targetCtx.beginPath();
                    targetCtx.moveTo(this.blobs[link.i].x*scaleX,this.blobs[link.i].y*scaleY);
                    targetCtx.lineTo(this.blobs[link.j].x*scaleX,this.blobs[link.j].y*scaleY);
                    targetCtx.stroke();
                }
            }
        }
        targetCtx.globalAlpha=1;
        targetCtx.setLineDash([]);
        targetCtx.fillStyle=trackerConfig.mainColor;
    }

    drawFrame() {
        if (this.canvas.width!==this.videoDrawW||this.canvas.height!==this.videoDrawH){
            this.canvas.width=this.videoDrawW;this.canvas.height=this.videoDrawH;
        }
        this.tempDisplayCtx.clearRect(0,0,BASE_WIDTH,BASE_HEIGHT);
        this.drawFrameToTarget(this.tempDisplayCtx,BASE_WIDTH,BASE_HEIGHT);
        this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
        this.ctx.drawImage(this.tempDisplayCanvas,this.videoDrawX,this.videoDrawY,this.videoDrawW,this.videoDrawH,0,0,this.videoDrawW,this.videoDrawH);
    }

    formatTime(seconds) {
        if (isNaN(seconds)||!isFinite(seconds)) return "00:00";
        return Math.floor(seconds/60).toString().padStart(2,'0')+':'+Math.floor(seconds%60).toString().padStart(2,'0');
    }

    // ════════════════════════════════════════════════════════════
    // ★ OFFLINE FRAME-BY-FRAME EXPORT — 两阶段精准时长方案
    //
    // 根本原因（48s Bug）：
    //   旧代码 captureStream(0) + requestFrame() 依赖墙钟记录 PTS。
    //   每帧 seek 耗时 ~150ms >> frameIntervalMs(33ms)，
    //   导致 270帧 x 183ms = 49s 被 MediaRecorder 记录为视频时长。
    //
    // 彻底修复：两阶段解耦
    //   阶段1 (离线捕获): seek -> 渲染 -> 压缩为 JPEG Blob，与时钟无关
    //   阶段2 (定速回放): 以精准帧间隔把 Blob 推入 MediaRecorder
    //     每帧仅需 createImageBitmap+drawImage (~5-8ms) << frameIntervalMs
    //     绝对时钟定速：nextDeadline = phaseStart + (i+1) * frameIntervalMs
    //     输出时长 = totalFrames / exportFps = 原视频时长 ✓
    // ════════════════════════════════════════════════════════════
    async startExport(format, resolution, fpsStr) {
        // ── 前置校验 ──
        if (this.isExporting) { this.onToast('导出进行中，请等待完成'); return; }
        if (this.isRunning)   { this.onToast('请先暂停追踪，再导出视频'); return; }
        if (this.isCamera)    { this.onToast('摄像头模式不支持导出，请上传本地视频文件'); return; }
        if (!this.originalVideoDuration || !isFinite(this.originalVideoDuration)) {
            this.onToast('视频未加载或时长无效，请重新上传'); return;
        }
        if (!this.originalVideoFps || this.originalVideoFps < 1) {
            this.onToast('视频帧率检测失败，请重新上传视频'); return;
        }

        // ── 确定导出分辨率 ──
        let width = BASE_WIDTH, height = BASE_HEIGHT;
        if      (resolution === 'original') { width = this.originalVideoWidth;  height = this.originalVideoHeight; }
        else if (resolution === '1080p')    { width = 1920; height = 1080; }
        else if (resolution === '720p')     { width = 1280; height = 720;  }
        else if (resolution === '480p')     { width = 854;  height = 480;  }

        // ── 确定导出帧率（最高优先级：用户设置；默认：原视频帧率）──
        let fps = (fpsStr === 'original') ? this.originalVideoFps : parseInt(fpsStr, 10);
        if (!fps || fps < 1) fps = this.originalVideoFps;

        // ── 二次校验：参数超出原视频规格则提示降级 ──
        const needClamp = (width > this.originalVideoWidth || height > this.originalVideoHeight || fps > this.originalVideoFps);
        if (needClamp) {
            const origW = this.originalVideoWidth, origH = this.originalVideoHeight;
            const clampW   = Math.min(width,  origW);
            const clampH   = Math.min(height, origH);
            const clampFps = Math.min(fps, this.originalVideoFps);
            const choice = await window._showExportConfirmModal(
                { width: origW, height: origH, fps: this.originalVideoFps },
                { width: clampW, height: clampH, fps: clampFps }
            );
            if (choice !== 'ok') return;
            width = clampW; height = clampH; fps = clampFps;
        }

        // ── 锁定导出参数 ──
        const exportFps       = fps;
        const frameIntervalMs = 1000 / exportFps;
        // 总帧数 = floor(时长 × 帧率)，严格匹配原视频时长，禁止超出
        const totalFrames     = Math.floor(this.originalVideoDuration * exportFps);

        console.log('===================================================');
        console.log('[BlobTracker] 原视频真实帧率：', this.originalVideoFps, 'fps');
        console.log('[BlobTracker] 原视频总时长：', this.originalVideoDuration.toFixed(4), 's');
        console.log('[BlobTracker] 计算总帧数：', totalFrames, '帧');
        console.log('[Export] 导出分辨率：', width, 'x', height);
        console.log('[Export] 导出帧率：', exportFps, 'fps  (设置=' + fpsStr + ')');
        console.log('[Export] 帧间隔：', frameIntervalMs.toFixed(4), 'ms');
        console.log('[Export] 预期总时长：', (totalFrames / exportFps).toFixed(4), 's');
        console.log('===================================================');

        this.isExporting  = true;
        this.exportAbort  = false;
        this.prevBlobs    = [];
        this.blobs        = [];
        // ★ 重置帧差缓冲区：防止导出首帧因残留历史灰度产生错误运动检测
        this.prevFrameGray.fill(0);
        this.currentGray.fill(0);
        this.blurredGray.fill(0);

        // ── 建立导出 Canvas ──
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width  = width;
        exportCanvas.height = height;
        const exportCtx = exportCanvas.getContext('2d', { alpha: false, willReadFrequently: false });
        exportCtx.imageSmoothingEnabled = true;
        exportCtx.imageSmoothingQuality = 'high';

        // ── MIME 类型选择 ──
        let mime, actualFormat;
        const preferred = format === 'mp4'
            ? ['video/mp4;codecs=h264', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
            : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=h264', 'video/mp4'];
        mime = null;
        for (const m of preferred) { if (MediaRecorder.isTypeSupported(m)) { mime = m; break; } }
        if (!mime) mime = 'video/webm';
        actualFormat = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
        if (actualFormat !== format) {
            this.onToast('当前浏览器不支持 ' + format.toUpperCase() + ' ，已自动切换为 ' + actualFormat.toUpperCase());
        }

        // ── 码率：最低 16Mbps，或按分辨率×帧率×0.15 计算 ──
        const bitsPerSecond = Math.max(16000000, width * height * exportFps * 0.15);

        // ════════════════════════════════════════════════════════
        // ★ 阶段1：纯离线逐帧捕获（与墙钟完全解耦）
        //   逐帧 seek → 等待 seeked 事件（含最多2次重试）→
        //   渲染 blob 跟踪特效 → 压缩为 JPEG Blob 存入内存
        //   耗时无论多长，均不影响最终视频的 PTS 或时长
        // ════════════════════════════════════════════════════════
        console.log('[Export] 阶段1开始：离线帧捕获，共', totalFrames, '帧');
        this.onToast('\u23f3 \u9636\u6bb51/2 \u6355\u83b7\u5e27\u4e2d... 0/' + totalFrames);

        const frameBlobs = [];  // 所有帧的压缩 Blob

        for (let i = 0; i < totalFrames; i++) {
            if (this.exportAbort) {
                console.log('[Export] 用户中止（阶段1 frame ' + i + ')');
                this.isExporting = false;
                this.onProgress(0, 0, 0);
                return;
            }

            const targetTime = i / exportFps;

            // ★ 修复差分失真：先 seek 到前一帧采集 prevFrameGray
            // 确保差分始终是时序相邻的两帧，而非 seek 跳跃的任意帧
            if (i > 0) {
                const prevTime = (i - 1) / exportFps;
                await this._seekTo(this.video, prevTime);
                // 采集前一帧灰度到 prevFrameGray
                this.sourceCtx.clearRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
                this.sourceCtx.drawImage(this.video, this.videoDrawX, this.videoDrawY, this.videoDrawW, this.videoDrawH);
                const prevFrame = this.sourceCtx.getImageData(0, 0, BASE_WIDTH, BASE_HEIGHT);
                this.getGrayData(prevFrame, this.prevFrameGray);
                // 应用同样的模糊处理，与 updateBlobs 保持一致
                if (trackerConfig.skipFrames <= 2) {
                    const tempBlur = new Uint8Array(BASE_WIDTH * BASE_HEIGHT);
                    this.fastGaussianBlur(this.prevFrameGray, tempBlur, this.gaussianTempBuffer, BASE_WIDTH, BASE_HEIGHT);
                    this.prevFrameGray.set(tempBlur);
                }
            } else {
                // 首帧：清空 prevFrameGray，确保不会因残留数据产生错误差分
                this.prevFrameGray.fill(0);
            }

            // ★ 精准 seek：等待 seeked 事件，最多2次重试，600ms 超时兜底
            await this._seekTo(this.video, targetTime);

            // ★ 渲染：更新 blob 跟踪状态 + 绘制当前帧特效
            // 此时 prevFrameGray 已确保是时序相邻的前一帧
            this.updateBlobsForExport();
            // ★ 导出时生成连线/闪线决策，确保特效在导出视频中稳定不闪烁
            this._updateLinkDecisions();
            this.tempDisplayCtx.clearRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
            this.drawFrameToTarget(this.tempDisplayCtx, BASE_WIDTH, BASE_HEIGHT, i);

            // 缩放渲染结果到导出分辨率
            exportCtx.clearRect(0, 0, width, height);
            exportCtx.drawImage(
                this.tempDisplayCanvas,
                this.videoDrawX, this.videoDrawY, this.videoDrawW, this.videoDrawH,
                0, 0, width, height
            );

            // ★ 压缩为 JPEG Blob（质量 0.94，在画质与内存间取得平衡）
            const blob = await new Promise(resolve =>
                exportCanvas.toBlob(resolve, 'image/jpeg', 0.94)
            );
            frameBlobs.push(blob);

            // 进度更新：阶段1 占 0%-50%
            const p1 = Math.floor(((i + 1) / totalFrames) * 50);
            this.onProgress(p1, targetTime, this.originalVideoDuration);
            if (i % Math.max(1, Math.floor(exportFps)) === 0) {
                this.onToast('\u23f3 \u9636\u6bb51/2 \u6355\u83b7 ' + p1 + '% (' + (i + 1) + '/' + totalFrames + ')');
            }

            // 每10帧让出主线程，保持 UI 响应
            if (i % 10 === 9) await this._sleepMs(0);
        }

        if (this.exportAbort) {
            this.isExporting = false;
            this.onProgress(0, 0, 0);
            return;
        }

        console.log('[Export] 阶段1完成，捕获', frameBlobs.length, '帧');

        // ════════════════════════════════════════════════════════
        // ★ 阶段2：绝对时钟定速推帧 → MediaRecorder
        //   阶段2中每帧仅需 createImageBitmap + drawImage (~5-8ms)，
        //   远小于 frameIntervalMs，因此能以极高精度保持帧间隔。
        //
        //   绝对时钟计时：
        //     phaseStart = performance.now() （阶段2起点）
        //     第 i 帧推帧后，等到 phaseStart + (i+1) × frameIntervalMs
        //   确保 requestFrame() 以 frameIntervalMs 的墙钟间隔触发，
        //   MediaRecorder 将此间隔作为 PTS 写入容器。
        //   输出视频时长 = totalFrames × frameIntervalMs ≈ 原视频时长 ✓
        // ════════════════════════════════════════════════════════
        console.log('[Export] 阶段2开始：定速回放编码，帧间隔', frameIntervalMs.toFixed(4), 'ms');

        // 建立 captureStream + MediaRecorder
        const stream     = exportCanvas.captureStream(0);
        const videoTrack = stream.getVideoTracks()[0];
        const recorder   = new MediaRecorder(stream, {
            mimeType:           mime,
            videoBitsPerSecond: bitsPerSecond,
        });

        // 向底层编码器声明期望帧率（帮助编码器优化）
        if (videoTrack && videoTrack.applyConstraints) {
            try { await videoTrack.applyConstraints({ frameRate: { exact: exportFps } }); }
            catch(e) {
                try { await videoTrack.applyConstraints({ frameRate: exportFps }); } catch(_) {}
            }
        }

        const chunks = [];
        recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };

        const exportDone = new Promise(resolve => {
            recorder.onstop = async () => {
                const blob = new Blob(chunks, { type: mime });
                const url  = URL.createObjectURL(blob);
                const a    = document.createElement('a');
                a.href     = url;
                a.download = 'BlobTrack_' + Date.now() + '.' + actualFormat;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 2000);
                this.onToast(
                    '\u2705 \u5bfc\u51fa\u5b8c\u6210\uff01' + totalFrames +
                    '\u5e27 @ ' + exportFps + 'fps | ' +
                    (blob.size / 1024 / 1024).toFixed(2) + ' MB | ' +
                    actualFormat.toUpperCase()
                );
                this.isExporting = false;
                this.onProgress(0, 0, 0);
                this.video.pause();
                this.video.currentTime = 0;
                this.sourceCtx.clearRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
                this.prevBlobs = [];
                this.blobs     = [];
                resolve();
            };
            recorder.onerror = (e) => {
                console.error('[Export] MediaRecorder 错误:', e);
                this.isExporting = false;
                this.onToast('\u5bfc\u51fa\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5');
                resolve();
            };
        });

        // ★ 预热帧：recorder.start() 前先推一帧黑色激活流，不被录入
        exportCtx.fillStyle = '#000';
        exportCtx.fillRect(0, 0, width, height);
        if (videoTrack.requestFrame) videoTrack.requestFrame();
        await this._sleepMs(50);  // 等待 stream 激活

        recorder.start(1);  // timeslice=1ms，细粒度数据块
        this.onToast(
            '\u23f3 \u9636\u6bb52/2 \u7f16\u7801\u4e2d... ' + totalFrames +
            '\u5e27 @ ' + exportFps + 'fps | ' + width + '\u00d7' + height
        );

        // ★★★ 阶段2 核心：绝对时钟定速推帧 ★★★
        const phaseStart = performance.now();

        for (let i = 0; i < frameBlobs.length; i++) {
            if (this.exportAbort) {
                console.log('[Export] 用户中止（阶段2 frame ' + i + ')');
                break;
            }

            // 从 JPEG Blob 恢复 ImageBitmap（GPU 加速解码，~3-8ms）
            const bitmap = await createImageBitmap(frameBlobs[i]);
            exportCtx.clearRect(0, 0, width, height);
            exportCtx.drawImage(bitmap, 0, 0, width, height);
            bitmap.close();       // 立即释放 GPU 资源
            frameBlobs[i] = null; // 立即释放 Blob 内存

            // ★ 推帧：MediaRecorder 以此墙钟时刻为 PTS
            if (videoTrack.requestFrame) videoTrack.requestFrame();

            // ★ 绝对时钟定速等待：
            //   下一帧的目标墙钟时刻 = phaseStart + (i+1) × frameIntervalMs
            //   若当前已超时（慢帧），立刻处理下一帧（不累积延迟）
            const nextDeadline = phaseStart + (i + 1) * frameIntervalMs;
            const waitMs = nextDeadline - performance.now();
            if (waitMs > 1) await this._sleepMs(waitMs);

            // 进度更新：阶段2 占 50%-100%
            const p2 = 50 + Math.floor(((i + 1) / frameBlobs.length) * 50);
            this.onProgress(p2, (i + 1) / exportFps, this.originalVideoDuration);
            if (i % Math.max(1, Math.floor(exportFps)) === 0) {
                this.onToast('\u23f3 \u9636\u6bb52/2 \u7f16\u7801 ' + p2 + '% (' + (i + 1) + '/' + totalFrames + '\u5e27)');
            }
            if (i % 20 === 19) await this._sleepMs(0); // 让出主线程
        }

        // 等待尾帧完全刷入再停止录制
        await this._sleepMs(Math.max(300, frameIntervalMs * 3));
        if (recorder.state !== 'inactive') recorder.stop();
        await exportDone;
    }

    // ★ 精确计时辅助：比 setTimeout 更准确（使用 performance.now 补偿）
    _sleepMs(ms) {
        if (ms <= 0) return Promise.resolve();
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ★ 精准 seek：等待 seeked 事件 + 非关键帧兼容处理
    // 对于 B 帧视频，seek 可能停在最近的关键帧，需要容差处理
    _seekTo(video, time) {
        return new Promise(resolve => {
            // 已在目标时间附近（容差 0.5ms）则直接返回
            if (Math.abs(video.currentTime - time) < 0.0005) { resolve(); return; }

            let settled = false;
            let retryCount = 0;
            const MAX_RETRY = 3;

            const done = (reason) => {
                if (settled) return;
                settled = true;
                video.removeEventListener('seeked', onSeeked);
                clearTimeout(safetyTimeout);
                resolve();
            };

            const onSeeked = () => {
                // 验证是否到达目标附近（非关键帧可能跳到最近关键帧，容差 0.5 帧）
                const tolerance = 0.5 / (this.originalVideoFps || 30);
                if (Math.abs(video.currentTime - time) <= tolerance) {
                    done('seeked');
                } else if (retryCount < MAX_RETRY) {
                    // 未到目标，重试 seek（处理 B 帧非关键帧情况）
                    retryCount++;
                    video.currentTime = time;
                } else {
                    // 多次重试仍偏差，接受当前位置继续
                    console.warn(`[Export] seek 偏差: 目标=${time.toFixed(4)}s 实际=${video.currentTime.toFixed(4)}s`);
                    done('tolerance');
                }
            };

            video.addEventListener('seeked', onSeeked);
            video.currentTime = time;

            // 安全超时：600ms 后强制继续，避免 seek 卡死整个导出
            const safetyTimeout = setTimeout(() => {
                console.warn(`[Export] seek 超时 time=${time.toFixed(4)}s`);
                done('timeout');
            }, 600);
        });
    }
}

// ============================================================
//  I18N DICTIONARY
// ============================================================
const dict = {
    upload:           { en:'Upload Video',        cn:'上传视频' },
    camera:           { en:'Camera',              cn:'摄像头' },
    start:            { en:'Start Tracking',      cn:'开始运行' },
    pause:            { en:'Pause Tracking',      cn:'暂停' },
    exportSettings:   { en:'Export Settings',     cn:'导出设置' },
    resolution:       { en:'Resolution',          cn:'导出分辨率' },
    original:         { en:'Original',            cn:'原视频' },
    framerate:        { en:'Framerate',           cn:'导出帧率' },
    exportMp4:        { en:'Export MP4',          cn:'导出 MP4' },
    exportWebm:       { en:'Export WebM',         cn:'导出 WebM' },
    videoSpeed:       { en:'Video Speed',         cn:'视频速度' },
    perfSettings:     { en:'Performance',         cn:'性能设置' },
    skipFrames:       { en:'Skip Frames (Higher = Smoother)', cn:'跳帧设置（数值越大越流畅）' },
    shape:            { en:'Shape',               cn:'形状' },
    square:           { en:'Square',              cn:'方形' },
    circle:           { en:'Circle',              cn:'圆形' },
    diamond:          { en:'Diamond',             cn:'菱形' },
    regionStyle:      { en:'Region Style',        cn:'区域样式' },
    randomStyle:      { en:'Random Border Style', cn:'随机边框样式' },
    randomFilter:     { en:'Random Filter Style', cn:'随机滤镜样式' },
    baseBorder:       { en:'Base Border',         cn:'基础边框' },
    innerFilter:      { en:'Inner Filter',        cn:'框内滤镜效果' },
    innerInvert:      { en:'Inner Invert',        cn:'内部反色' },
    globalInvert:     { en:'Global Invert',       cn:'整体反色' },
    blend:            { en:'Blend',               cn:'画面融合' },
    filterInvertMode: { en:'Filter Invert Mode',  cn:'滤镜反转模式' },
    keepOriginalInner:{ en:'Keep Original Inner, Filter Outer', cn:'框内保持原图，外面滤镜' },
    innerFlashLine:   { en:'Inner Flash Line',    cn:'框内黑白闪线' },
    enableFlashLine:  { en:'Enable Flash Line',   cn:'开启框内闪线' },
    connections:      { en:'Connections',         cn:'连线' },
    centerHub:        { en:'Center Hub Mode',     cn:'中心连线模式' },
    linkRate:         { en:'Link Probability',    cn:'连线概率' },
    linkDist:         { en:'Max Link Distance',   cn:'最大连线距离' },
    lineStyle:        { en:'Line Style',          cn:'线条样式' },
    solid:            { en:'Solid',               cn:'实线' },
    dashed:           { en:'Dashed',              cn:'虚线' },
    dotted:           { en:'Dotted',              cn:'点线' },
    dashdot:          { en:'Dash-dot',            cn:'点划线' },
    lineWidth:        { en:'Line Width',          cn:'线条粗细' },
    boxSize:          { en:'Bounding Box Size',   cn:'追踪框大小' },
    sameSize:         { en:'Uniform Size',        cn:'统一尺寸' },
    minArea:          { en:'Min Blob Area Filter', cn:'最小面积过滤' },
    maxBlobs:         { en:'Max Tracked Blobs',   cn:'跟踪点数量' },
    singleTrack:      { en:'Single Target Tracking', cn:'单目标追踪' },
    onlyTrackLargest: { en:'Only track largest subject', cn:'仅追踪最大主体' },
    fontStyle:        { en:'Font Style',          cn:'字体样式自定义' },
    fontFamily:       { en:'Font Family',         cn:'字体' },
    fontSize:         { en:'Font Size',           cn:'字号' },
    fontWeight:       { en:'Font Weight',         cn:'字重' },
    colorAndText:     { en:'Color & Text',        cn:'颜色与文字' },
    crazyMode:        { en:'Color Random Style',  cn:'颜色随机样式' },
    textPos:          { en:'Text Position',       cn:'文字位置' },
    center:           { en:'Center',              cn:'居中' },
    top:              { en:'Top',                 cn:'顶部' },
    bottom:           { en:'Bottom',              cn:'底部' },
    textContent:      { en:'Text Content',        cn:'文字内容' },
    textPlaceholder:  { en:'Leave empty for random values', cn:'不填则显示随机数值' },
    separateColor:    { en:'Separate Colors',     cn:'独立颜色' },
    mainColor:        { en:'Main Color',          cn:'主颜色' },
    textColor:        { en:'Text Color',          cn:'文字颜色' },
    lineColor:        { en:'Line Color',          cn:'线条颜色' },
    threshold:        { en:'Detection Threshold (Lower = More Sensitive)', cn:'识别阈值（越小越灵敏）' },
    dotSize:          { en:'Center Dot Size',     cn:'中心点大小' },
    themePalette:     { en:'Theme Palette',       cn:'背景特效主题' },
    noVideo:          { en:'No Video Source',     cn:'暂无视频源' },
    loopPlayback:     { en:'Loop Playback',       cn:'循环播放' },
    fontWeightNormal: { en:'normal',               cn:'normal' },
    fontWeightBold:   { en:'bold',                 cn:'bold' },
    fontWeightSemiBold: { en:'semi-bold',          cn:'semi-bold' },
};

// ============================================================
//  APP STATE
// ============================================================
let currentLang = 'cn';
let currentPaletteKey = 'default';
let isRunning = false;
let progressValue = 0;

const video   = document.getElementById('video');
const canvas  = document.getElementById('main-canvas');
const tracker = new BlobTracker(video, canvas);

// ============================================================
//  TOAST
// ============================================================
let toastTimer = null;
function showToast(msg) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-text').textContent = msg;
    toast.classList.add('visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3000);
}

tracker.onToast = showToast;
tracker.onProgress = (prog, curr, tot) => {
    progressValue = prog;
    document.getElementById('progress-fill').style.width = prog + '%';
    document.getElementById('time-current').textContent = formatTime(curr);
    document.getElementById('time-total').textContent   = formatTime(tot);
    if (prog > 0) document.getElementById('empty-state').style.display = 'none';
};
tracker.onStateChange = running => {
    isRunning = running;
    updateRunButton();
};
tracker.onVideoLoad = aspect => {
    const container = document.getElementById('canvas-container');
    const area = document.getElementById('canvas-area');
    const areaW = area.clientWidth - 32, areaH = area.clientHeight - 80;
    let w = areaW, h = areaW / aspect;
    if (h > areaH) { h = areaH; w = areaH * aspect; }
    container.style.width  = w + 'px';
    container.style.height = h + 'px';
    document.getElementById('empty-state').style.display = 'none';
};

function formatTime(s) {
    if (isNaN(s)||!isFinite(s)) return "00:00";
    return Math.floor(s/60).toString().padStart(2,'0')+':'+Math.floor(s%60).toString().padStart(2,'0');
}

// ============================================================
//  UI COLOR / PALETTE
// ============================================================
function getUiColor() {
    return PALETTES[currentPaletteKey][0] || '#ffffff';
}

function applyUiColor() {
    const c = getUiColor();
    // 设置CSS变量供action-btn和export-btn使用
    document.documentElement.style.setProperty('--theme-color', c);
    document.documentElement.style.setProperty('--theme-color-alpha', `${c}80`);
    
    // Title dot: colored + glow
    const dot = document.getElementById('title-dot');
    dot.style.backgroundColor = c;
    dot.style.boxShadow = `0 0 10px ${c}, 0 0 20px ${c}60`;

    // Toast dot: colored + glow
    const toastDot = document.getElementById('toast-dot');
    toastDot.style.backgroundColor = c;
    toastDot.style.boxShadow = `0 0 8px ${c}`;

    // Progress fill: colored + subtle glow
    const fill = document.getElementById('progress-fill');
    fill.style.backgroundColor = c;
    fill.style.boxShadow = `0 0 8px ${c}80`;

    // Panel: glassmorphic background tinted with palette color (8%)
    // This replicates color-mix(in srgb, uiColor 8%, rgba(0,0,0,0.3))
    document.getElementById('panel').style.backgroundColor = hexColorMix(c, 8);

    // Panel shadow with color tint (subtle ambient)
    document.getElementById('panel').style.boxShadow =
        `4px 0 40px rgba(0,0,0,0.4), inset -1px 0 0 rgba(255,255,255,0.05), 0 0 60px ${c}10`;

    updateRunButton();
    buildSpeedButtons(); // refresh speed btns color
    updateAllSegButtonsGlow(); // 更新所有seg-btn的晕光效果
    updateSwitchGlow(); // 更新switch的晕光效果
    
    // 更新下拉框背景色与主题色联动
    const dropdownBg = computeDropdownBgColor(c);
    document.documentElement.style.setProperty('--dropdown-bg', dropdownBg);
}

function hexColorMix(hex, pct) {
    // Properly compute: color-mix(in srgb, uiColor pct%, rgba(0,0,0,0.3))
    // = uiColor*(pct/100) blended with rgba(0,0,0,0.3)*(1-pct/100)
    try {
        const h = hex.replace('#','').trim();
        const parse = s => parseInt(s, 16);
        let r, g, b;
        if (h.length === 3) {
            r = parse(h[0]+h[0]); g = parse(h[1]+h[1]); b = parse(h[2]+h[2]);
        } else {
            r = parse(h.slice(0,2)); g = parse(h.slice(2,4)); b = parse(h.slice(4,6));
        }
        const ratio = pct / 100;
        // Weighted mix: color at ratio, dark-transparent at (1-ratio)
        // Result alpha = 1.0*ratio + 0.3*(1-ratio)
        const alpha = ratio + 0.3 * (1 - ratio);
        // Premult then un-premult: simplified since dark = 0,0,0
        const finalR = Math.round(r * ratio);
        const finalG = Math.round(g * ratio);
        const finalB = Math.round(b * ratio);
        return `rgba(${finalR},${finalG},${finalB},${alpha.toFixed(3)})`;
    } catch(e) {
        return `rgba(0,0,0,0.3)`;
    }
}

function computeDropdownBgColor(hex) {
    try {
        const h = hex.replace('#','').trim();
        const parse = s => parseInt(s, 16);
        let r, g, b;
        if (h.length === 3) {
            r = parse(h[0]+h[0]); g = parse(h[1]+h[1]); b = parse(h[2]+h[2]);
        } else {
            r = parse(h.slice(0,2)); g = parse(h.slice(2,4)); b = parse(h.slice(4,6));
        }
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let hslH = 0, hslS = 0, hslL = (max + min) / 2 / 255;
        if (max !== min) {
            const d = max - min;
            hslS = hslL > 0.5 ? d / (510 - max - min) : d / (max + min);
            if (max === r) hslH = ((g - b) / d + (g < b ? 6 : 0)) / 6;
            else if (max === g) hslH = ((b - r) / d + 2) / 6;
            else hslH = ((r - g) / d + 4) / 6;
        }
        const newL = 0.10 + (hslL * 0.08);
        const newS = Math.min(0.20, hslS * 0.4);
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        let newR, newG, newB;
        if (newS === 0) {
            newR = newG = newB = newL;
        } else {
            const q = newL < 0.5 ? newL * (1 + newS) : newL + newS - newL * newS;
            const p = 2 * newL - q;
            newR = hue2rgb(p, q, hslH + 1/3);
            newG = hue2rgb(p, q, hslH);
            newB = hue2rgb(p, q, hslH - 1/3);
        }
        return `rgba(${Math.round(newR * 255)},${Math.round(newG * 255)},${Math.round(newB * 255)},0.42)`;
    } catch(e) {
        return `rgba(10,10,12,0.42)`;
    }
}

function applyColors() {
    if (window._cbSetColors) window._cbSetColors(PALETTES[currentPaletteKey]);
    applyUiColor();
}

// ============================================================
//  BUILD PALETTE GRID
// ============================================================
function buildPaletteGrid() {
    const grid = document.getElementById('palette-grid');
    grid.innerHTML = '';
    Object.keys(PALETTES).forEach(key => {
        const btn = document.createElement('button');
        btn.className = 'palette-btn' + (key === currentPaletteKey ? ' active' : '');
        const p = PALETTES[key];
        if (p.length > 0) btn.style.background = `linear-gradient(135deg, ${p[0]}, ${p[1] || p[0]})`;
        else btn.style.background = '#555';
        btn.title = key;
        btn.addEventListener('click', () => {
            currentPaletteKey = key;
            document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyColors();
        });
        grid.appendChild(btn);
    });
}

// ============================================================
//  BUILD SEGMENTED BUTTON GROUPS
// ============================================================
function buildSegGroup(containerId, items, configKey, labelMap) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const c = getUiColor();
    container.innerHTML = '';
    items.forEach(val => {
        const btn = document.createElement('button');
        const isActive = trackerConfig[configKey] === val;
        btn.className = 'seg-btn' + (isActive ? ' active' : '');
        btn.dataset.val = val;
        btn.textContent = labelMap ? (labelMap[val] || val) : val;
        // 初始化激活状态的样式
        if (isActive) {
            btn.style.backgroundColor = c;
            btn.style.borderColor = c;
            btn.style.boxShadow = `0 0 12px ${c}80`;
            btn.style.color = '#000';
        }
        btn.addEventListener('click', () => {
            const uiColor = getUiColor();
            trackerConfig[configKey] = val;
            container.querySelectorAll('.seg-btn').forEach(b => {
                b.classList.remove('active');
                // 重置样式
                b.style.backgroundColor = '';
                b.style.borderColor = '';
                b.style.boxShadow = '';
                b.style.color = '';
            });
            btn.classList.add('active');
            // 应用主题色晕光效果
            btn.style.backgroundColor = uiColor;
            btn.style.borderColor = uiColor;
            btn.style.boxShadow = `0 0 12px ${uiColor}80`;
            btn.style.color = '#000';
            if (!tracker.isRunning) tracker.drawFrame();
        });
        container.appendChild(btn);
    });
    setupGlowEffect();
}

// ============================================================
//  BUILD SPEED BUTTONS
// ============================================================
function buildSpeedButtons() {
    const g = document.getElementById('speed-group');
    g.innerHTML = '';
    [1,2,3,4].forEach(s => {
        const btn = document.createElement('button');
        btn.className = 'speed-btn';
        btn.textContent = s + 'x';
        const uiColor = getUiColor();
        if (trackerConfig.speed === s) {
            btn.style.backgroundColor = uiColor;
            btn.style.color = '#000';
            btn.style.borderColor = uiColor;
            btn.style.boxShadow = `0 0 12px ${uiColor}80`;
        } else {
            btn.style.backgroundColor = 'rgba(255,255,255,0.05)';
            btn.style.color = '#fff';
            btn.style.borderColor = 'rgba(255,255,255,0.1)';
            btn.style.boxShadow = 'none';
        }
        btn.addEventListener('click', () => {
            trackerConfig.speed = s;
            if (video && !tracker.isCamera) video.playbackRate = s;
            buildSpeedButtons();
        });
        g.appendChild(btn);
    });
    setupGlowEffect();
}

// ============================================================
//  SWITCHES
// ============================================================
function initSwitches() {
    document.querySelectorAll('.switch').forEach(sw => {
        const key = sw.dataset.key;
        if (!key) return;
        updateSwitch(sw, trackerConfig[key]);
        sw.addEventListener('click', () => {
            trackerConfig[key] = !trackerConfig[key];
            updateSwitch(sw, trackerConfig[key]);
            // Special handling
            if (key === 'loopPlayback') video.loop = trackerConfig.loopPlayback;
            if (!tracker.isRunning && (tracker.isCamera || tracker.originalVideoDuration)) tracker.drawFrame();
        });
    });
}

function updateSwitch(sw, val) {
    const c = getUiColor();
    sw.style.backgroundColor = val ? c : 'rgba(255,255,255,0.2)';
    sw.style.boxShadow = val ? `0 0 12px ${c}80` : 'none';
    const thumb = sw.querySelector('.switch-thumb');
    if (thumb) thumb.style.transform = val ? 'translateX(16px)' : 'translateX(0)';
}

// 更新所有switch的晕光效果（主题色变化时调用）
function updateSwitchGlow() {
    const c = getUiColor();
    document.querySelectorAll('.switch').forEach(sw => {
        const key = sw.dataset.key;
        const isOn = trackerConfig[key];
        if (isOn) {
            sw.style.backgroundColor = c;
            sw.style.boxShadow = `0 0 12px ${c}80`;
        }
    });
}

// 更新所有seg-btn的晕光效果（主题色变化时调用）
function updateAllSegButtonsGlow() {
    const c = getUiColor();
    document.querySelectorAll('.seg-btn.active').forEach(btn => {
        btn.style.backgroundColor = c;
        btn.style.borderColor = c;
        btn.style.boxShadow = `0 0 12px ${c}80`;
        btn.style.color = '#000';
    });
}

// ============================================================
//  SLIDERS
// ============================================================
function initSliders() {
    const sliders = [
        { id:'sl-skipFrames',   key:'skipFrames',   valId:'val-skipFrames',  parse:parseInt },
        { id:'sl-linkRate',     key:'linkRate',      valId:'val-linkRate',    parse:v=>parseInt(v)/100, display:v=>Math.round(v*100)+'%' },
        { id:'sl-linkDist',     key:'linkDist',      valId:'val-linkDist',    parse:parseInt },
        { id:'sl-strokeWidth',  key:'strokeWidth',   valId:null,              parse:parseFloat },
        { id:'sl-boundingSize', key:'boundingSize',  valId:null,              parse:parseInt },
        { id:'sl-minArea',      key:'minArea',      valId:null,              parse:parseInt },
        { id:'sl-maxBlobs',     key:'maxBlobs',      valId:null,              parse:parseInt },
        { id:'sl-fontSize',     key:'fontSize',      valId:'val-fontSize',    parse:parseInt },
        { id:'sl-threshold',    key:'threshold',     valId:null,              parse:parseInt },
        { id:'sl-dotSize',      key:'dotSize',       valId:null,              parse:parseInt },
    ];
    sliders.forEach(({id, key, valId, parse, display}) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = trackerConfig[key] !== undefined ? (key==='linkRate'?Math.round(trackerConfig[key]*100):trackerConfig[key]) : el.value;
        updateSliderStyle(el);
        el.addEventListener('input', () => {
            trackerConfig[key] = parse(el.value);
            if (valId) {
                const vEl = document.getElementById(valId);
                if (vEl) vEl.textContent = display ? display(trackerConfig[key]) : trackerConfig[key];
            }
            updateSliderStyle(el);
            if (!tracker.isRunning) tracker.drawFrame();
        });
    });
}

function updateSliderStyle(el) {
    const min = parseFloat(el.min), max = parseFloat(el.max), val = parseFloat(el.value);
    const pct = ((val - min) / (max - min)) * 100;
    el.style.background = `linear-gradient(to right, white ${pct}%, rgba(0,0,0,0.4) ${pct}%)`;
}

// ============================================================
//  SELECT ELEMENTS
// ============================================================
function initSelects() {
    const selects = [
        { id:'sel-fontFamily',   key:'fontFamily',   panelId:'new-font-family-panel',    valueId:'new-font-family-value' },
        { id:'sel-fontWeight',   key:'fontWeight',   panelId:'new-font-weight-panel',    valueId:'new-font-weight-value' },
        { id:'sel-textPosition', key:'textPosition', panelId:'new-text-position-panel', valueId:'new-text-position-value' },
    ];
    selects.forEach(({id, key, panelId, valueId}) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = trackerConfig[key];
        el.addEventListener('change', () => {
            trackerConfig[key] = el.value;
            if (!tracker.isRunning) tracker.drawFrame();
        });
        // 同步新下拉组件的初始值
        const panel = document.getElementById(panelId);
        const valueEl = document.getElementById(valueId);
        if (panel && valueEl) {
            const selectedOption = el.querySelector('option:checked');
            const selectedLabel = selectedOption ? selectedOption.textContent : el.value;
            valueEl.textContent = selectedLabel;
            // 设置选项的active状态
            panel.querySelectorAll('.new-dropdown-option').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.value === el.value);
            });
        }
    });

    // Text input
    const txtInput = document.getElementById('inp-textContent');
    if (txtInput) {
        txtInput.value = trackerConfig.textContent;
        txtInput.addEventListener('input', () => {
            trackerConfig.textContent = txtInput.value;
            if (!tracker.isRunning) tracker.drawFrame();
        });
    }
}

// ============================================================
//  COLOR INPUTS
// ============================================================
// ============================================================
//  HARDCODED SEGMENTED BUTTON GROUPS
//  shape-group → trackerConfig.shape
//  linestyle-group → trackerConfig.lineStyle
// ============================================================
function initHardcodedSegGroups() {
    const c = getUiColor();
    const groups = [
        { containerId: 'shape-group',     configKey: 'shape' },
        { containerId: 'linestyle-group', configKey: 'lineStyle' },
    ];
    groups.forEach(({ containerId, configKey }) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.querySelectorAll('.seg-btn').forEach(btn => {
            const val = btn.dataset.val;
            if (!val) return;
            // Set correct initial active state from trackerConfig
            const isActive = trackerConfig[configKey] === val;
            if (isActive) {
                btn.classList.add('active');
                // 初始化激活状态的样式
                btn.style.backgroundColor = c;
                btn.style.borderColor = c;
                btn.style.boxShadow = `0 0 12px ${c}80`;
                btn.style.color = '#000';
            } else {
                btn.classList.remove('active');
            }
            btn.addEventListener('click', () => {
                const uiColor = getUiColor();
                trackerConfig[configKey] = val;
                container.querySelectorAll('.seg-btn').forEach(b => {
                    b.classList.remove('active');
                    // 重置样式
                    b.style.backgroundColor = '';
                    b.style.borderColor = '';
                    b.style.boxShadow = '';
                    b.style.color = '';
                });
                btn.classList.add('active');
                // 应用主题色晕光效果
                btn.style.backgroundColor = uiColor;
                btn.style.borderColor = uiColor;
                btn.style.boxShadow = `0 0 12px ${uiColor}80`;
                btn.style.color = '#000';
                if (!tracker.isRunning) tracker.drawFrame();
            });
        });
    });
}

function initColorInputs() {
    const colorInputs = [
        { id:'col-mainColor',  key:'mainColor' },
        { id:'col-textColor',  key:'textColor' },
        { id:'col-lineColor',  key:'lineColor' },
    ];
    colorInputs.forEach(({id, key}) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = trackerConfig[key];
        el.addEventListener('input', () => {
            trackerConfig[key] = el.value;
            if (!tracker.isRunning) tracker.drawFrame();
        });
    });
}

// ============================================================
//  RUN BUTTON
// ============================================================
function updateRunButton() {
    const btn = document.getElementById('run-btn');
    const icon = document.getElementById('run-icon');
    const lbl  = document.getElementById('lbl-run');
    const c = getUiColor();
    if (isRunning) {
        btn.style.backgroundColor = 'rgba(255,255,255,0.1)';
        btn.style.borderColor = 'rgba(255,255,255,0.2)';
        btn.style.color = '#fff';
        btn.style.border = '1px solid rgba(255,255,255,0.2)';
        btn.style.boxShadow = 'none';
        icon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
        icon.setAttribute('fill','none'); icon.setAttribute('stroke','currentColor'); icon.setAttribute('stroke-width','2');
        lbl.textContent = dict.pause[currentLang];
    } else {
        btn.style.backgroundColor = c;
        btn.style.borderColor = c;
        btn.style.color = '#000';
        btn.style.border = `1px solid ${c}`;
        btn.style.boxShadow = `0 0 12px ${c}80`;
        icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
        icon.setAttribute('fill','currentColor'); icon.setAttribute('stroke','none');
        lbl.textContent = dict.start[currentLang];
    }
}

// ============================================================
//  LANGUAGE
// ============================================================
function applyLang() {
    const L = currentLang;
    document.getElementById('lang-btn').textContent = L==='cn' ? 'EN' : '中';
    document.getElementById('lbl-upload').textContent = dict.upload[L];
    document.getElementById('lbl-camera').textContent = dict.camera[L];
    document.getElementById('lbl-theme').textContent = dict.themePalette[L];
    document.getElementById('lbl-export-settings').textContent = dict.exportSettings[L];
    document.getElementById('lbl-resolution').textContent = dict.resolution[L];
    document.getElementById('lbl-framerate').textContent = dict.framerate[L];
    document.getElementById('lbl-export-mp4').textContent = dict.exportMp4[L];
    document.getElementById('lbl-export-webm').textContent = dict.exportWebm[L];
    document.getElementById('lbl-video-speed').textContent = dict.videoSpeed[L];
    document.getElementById('lbl-loop').textContent = dict.loopPlayback[L];
    document.getElementById('lbl-perf').textContent = dict.perfSettings[L];
    document.getElementById('lbl-skip').textContent = dict.skipFrames[L];
    document.getElementById('lbl-shape').textContent = dict.shape[L];
    document.getElementById('shape-square').textContent = dict.square[L];
    document.getElementById('shape-circle').textContent = dict.circle[L];
    document.getElementById('shape-diamond').textContent = dict.diamond[L];
    document.getElementById('lbl-region-style').textContent = dict.regionStyle[L];
    document.getElementById('lbl-random-style').textContent = dict.randomStyle[L];
    document.getElementById('lbl-random-filter').textContent = dict.randomFilter[L];
    document.getElementById('lbl-base-border').textContent = dict.baseBorder[L];
    document.getElementById('lbl-inner-filter').textContent = dict.innerFilter[L];
    document.getElementById('lbl-inner-invert').textContent = dict.innerInvert[L];
    document.getElementById('lbl-global-invert').textContent = dict.globalInvert[L];
    document.getElementById('lbl-blend').textContent = dict.blend[L];
    document.getElementById('lbl-filter-invert-mode').textContent = dict.filterInvertMode[L];
    document.getElementById('lbl-keep-original').textContent = dict.keepOriginalInner[L];
    document.getElementById('lbl-flash-line').textContent = dict.innerFlashLine[L];
    document.getElementById('lbl-enable-flash').textContent = dict.enableFlashLine[L];
    document.getElementById('lbl-connections').textContent = dict.connections[L];
    document.getElementById('lbl-center-hub').textContent = dict.centerHub[L];
    document.getElementById('lbl-link-rate').textContent = dict.linkRate[L];
    document.getElementById('lbl-link-dist').textContent = dict.linkDist[L];
    document.getElementById('lbl-line-style').textContent = dict.lineStyle[L];
    document.getElementById('ls-solid').textContent = dict.solid[L];
    document.getElementById('ls-dashed').textContent = dict.dashed[L];
    document.getElementById('ls-dotted').textContent = dict.dotted[L];
    document.getElementById('ls-dashdot').textContent = dict.dashdot[L];
    document.getElementById('lbl-line-width').textContent = dict.lineWidth[L];
    document.getElementById('lbl-box-size').textContent = dict.boxSize[L];
    document.getElementById('lbl-same-size').textContent = dict.sameSize[L];
    document.getElementById('lbl-min-area').textContent = dict.minArea[L];
    document.getElementById('lbl-max-blobs').textContent = dict.maxBlobs[L];
    document.getElementById('lbl-single-track').textContent = dict.singleTrack[L];
    document.getElementById('lbl-only-largest').textContent = dict.onlyTrackLargest[L];
    document.getElementById('lbl-font-style').textContent = dict.fontStyle[L];
    document.getElementById('lbl-font-family').textContent = dict.fontFamily[L];
    document.getElementById('lbl-font-size').textContent = dict.fontSize[L];
    document.getElementById('lbl-font-weight').textContent = dict.fontWeight[L];
    document.getElementById('lbl-color-text').textContent = dict.colorAndText[L];
    document.getElementById('lbl-crazy').textContent = dict.crazyMode[L];
    document.getElementById('lbl-text-pos').textContent = dict.textPos[L];
    document.getElementById('lbl-text-content').textContent = dict.textContent[L];
    document.getElementById('inp-textContent').placeholder = dict.textPlaceholder[L];
    document.getElementById('lbl-separate-color').textContent = dict.separateColor[L];
    document.getElementById('lbl-main-color').textContent = dict.mainColor[L];
    document.getElementById('lbl-text-color').textContent = dict.textColor[L];
    document.getElementById('lbl-line-color').textContent = dict.lineColor[L];
    document.getElementById('lbl-threshold').textContent = dict.threshold[L];
    document.getElementById('lbl-dot-size').textContent = dict.dotSize[L];
    document.getElementById('lbl-no-video').textContent = dict.noVideo[L];
    // dropdown option text (i18n)
    const optOrig = document.getElementById('opt-original');
    if (optOrig) optOrig.textContent = dict.original[L];
    const optOrig2 = document.getElementById('opt-original2');
    if (optOrig2) optOrig2.textContent = dict.original[L];
    document.getElementById('opt-center').textContent = dict.center[L];
    document.getElementById('opt-top').textContent = dict.top[L];
    document.getElementById('opt-bottom').textContent = dict.bottom[L];
    
    // 更新新下拉组件的外部显示文本
    // 1. 导出分辨率下拉
    const exportResValue = document.getElementById('export-resolution').value;
    let newResLabel = '720P';
    if (exportResValue === 'original') newResLabel = dict.original[L];
    else if (exportResValue === '1080p') newResLabel = '1080P';
    else if (exportResValue === '720p') newResLabel = '720P';
    else if (exportResValue === '480p') newResLabel = '480P';
    document.getElementById('new-res-value').textContent = newResLabel;
    
    // 2. 导出帧率下拉
    const exportFpsValue = document.getElementById('export-fps').value;
    let newFpsLabel = '30 FPS';
    if (exportFpsValue === 'original') newFpsLabel = dict.original[L];
    else if (exportFpsValue === '60') newFpsLabel = '60 FPS';
    else if (exportFpsValue === '30') newFpsLabel = '30 FPS';
    else if (exportFpsValue === '24') newFpsLabel = '24 FPS';
    document.getElementById('new-fps-value').textContent = newFpsLabel;
    
    // 3. 字体下拉 (这些是英文字体名称，不需要翻译)
    const fontFamilyValue = document.getElementById('sel-fontFamily').value;
    document.getElementById('new-font-family-value').textContent = fontFamilyValue;
    
    // 4. 字重下拉
    const fontWeightValue = document.getElementById('sel-fontWeight').value;
    let newFontWeightLabel = 'normal';
    if (fontWeightValue === 'normal') newFontWeightLabel = dict.fontWeightNormal[L];
    else if (fontWeightValue === 'bold') newFontWeightLabel = dict.fontWeightBold[L];
    else if (fontWeightValue === '600') newFontWeightLabel = dict.fontWeightSemiBold[L];
    document.getElementById('new-font-weight-value').textContent = newFontWeightLabel;
    
    // 5. 文字位置下拉
    const textPositionValue = document.getElementById('sel-textPosition').value;
    let newTextPositionLabel = dict.center[L];
    if (textPositionValue === 'center') newTextPositionLabel = dict.center[L];
    else if (textPositionValue === 'top') newTextPositionLabel = dict.top[L];
    else if (textPositionValue === 'bottom') newTextPositionLabel = dict.bottom[L];
    document.getElementById('new-text-position-value').textContent = newTextPositionLabel;
    
    updateRunButton();
}

// ============================================================
//  EVENT LISTENERS
// ============================================================
document.getElementById('lang-btn').addEventListener('click', () => {
    currentLang = currentLang === 'cn' ? 'en' : 'cn';
    applyLang();
});

document.getElementById('upload-btn').addEventListener('click', () => {
    document.getElementById('file-input').click();
});

document.getElementById('file-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (file) await tracker.loadVideo(file);
    e.target.value = '';
});

document.getElementById('camera-btn').addEventListener('click', async () => {
    await tracker.startCamera();
});

document.getElementById('run-btn').addEventListener('click', () => {
    tracker.toggleRun();
});

document.getElementById('export-mp4-btn').addEventListener('click', () => {
    const res = document.getElementById('export-resolution').value;
    const fps = document.getElementById('export-fps').value;
    tracker.startExport('mp4', res, fps);
});

document.getElementById('export-webm-btn').addEventListener('click', () => {
    const res = document.getElementById('export-resolution').value;
    const fps = document.getElementById('export-fps').value;
    tracker.startExport('webm', res, fps);
});

document.getElementById('fullscreen-btn').addEventListener('click', () => {
    const c = document.getElementById('canvas-container');
    if (!document.fullscreenElement) {
        c.requestFullscreen().catch(err => showToast('Fullscreen error: ' + err.message));
    } else {
        document.exitFullscreen();
    }
});

// Progress bar click to seek
document.getElementById('progress-track').addEventListener('click', e => {
    if (!tracker.isCamera && tracker.originalVideoDuration) {
        const rect = e.currentTarget.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        video.currentTime = pos * tracker.originalVideoDuration;
        if (!tracker.isRunning) {
            tracker.updateBlobs();
            tracker.drawFrame();
        }
    }
});

// Video ended
video.addEventListener('ended', () => {
    if (tracker.isRunning) tracker.toggleRun();
});

// Video loop setting
video.loop = trackerConfig.loopPlayback;

// ============================================================
//  BUILD BORDER & FILTER BUTTON GRIDS
// ============================================================
function buildBorderGrid() {
    const container = document.getElementById('border-group');
    const c = getUiColor();
    const styles = ['base','label','frame','lframe','xframe','grid','dash','scope','win2k','label2','glow','reference'];
    styles.forEach(s => {
        const btn = document.createElement('button');
        const isActive = trackerConfig.baseStyle === s;
        btn.className = 'seg-btn' + (isActive ? ' active' : '');
        btn.textContent = s;
        // 初始化激活状态的样式
        if (isActive) {
            btn.style.backgroundColor = c;
            btn.style.borderColor = c;
            btn.style.boxShadow = `0 0 12px ${c}80`;
            btn.style.color = '#000';
        }
        btn.addEventListener('click', () => {
            const uiColor = getUiColor();
            trackerConfig.baseStyle = s;
            container.querySelectorAll('.seg-btn').forEach(b => {
                b.classList.remove('active');
                // 重置样式
                b.style.backgroundColor = '';
                b.style.borderColor = '';
                b.style.boxShadow = '';
                b.style.color = '';
            });
            btn.classList.add('active');
            // 应用主题色晕光效果
            btn.style.backgroundColor = uiColor;
            btn.style.borderColor = uiColor;
            btn.style.boxShadow = `0 0 12px ${uiColor}80`;
            btn.style.color = '#000';
            if (!tracker.isRunning) tracker.drawFrame();
        });
        container.appendChild(btn);
    });
}

function buildFilterGrid() {
    const container = document.getElementById('filter-group');
    const c = getUiColor();
    const filters = ['none','invert','glitch','thermal','pixel','tone','blur','dither','zoom','xray','water','mask','crt','edge'];
    filters.forEach(f => {
        const btn = document.createElement('button');
        const isActive = trackerConfig.filter === f;
        btn.className = 'seg-btn' + (isActive ? ' active' : '');
        btn.textContent = f === 'none' ? 'None' : f;
        // 初始化激活状态的样式
        if (isActive) {
            btn.style.backgroundColor = c;
            btn.style.borderColor = c;
            btn.style.boxShadow = `0 0 12px ${c}80`;
            btn.style.color = '#000';
        }
        btn.addEventListener('click', () => {
            const uiColor = getUiColor();
            trackerConfig.filter = f;
            container.querySelectorAll('.seg-btn').forEach(b => {
                b.classList.remove('active');
                // 重置样式
                b.style.backgroundColor = '';
                b.style.borderColor = '';
                b.style.boxShadow = '';
                b.style.color = '';
            });
            btn.classList.add('active');
            // 应用主题色晕光效果
            btn.style.backgroundColor = uiColor;
            btn.style.borderColor = uiColor;
            btn.style.boxShadow = `0 0 12px ${uiColor}80`;
            btn.style.color = '#000';
            if (!tracker.isRunning) tracker.drawFrame();
        });
        container.appendChild(btn);
    });
}

// ============================================================
//  新导出下拉组件交互逻辑
// ============================================================
function toggleNewDropdown(panelId) {
    const panel = document.getElementById(panelId);
    document.querySelectorAll('.new-export-dropdown').forEach(p => {
        if (p.id !== panelId) p.classList.remove('open');
    });
    panel.classList.toggle('open');
}

function selectNewDropdownOption(panelId, value, label) {
    const panel = document.getElementById(panelId);
    panel.querySelectorAll('.new-dropdown-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.value === value);
    });
    if (panelId === 'new-export-res-panel') {
        document.getElementById('new-res-value').textContent = label;
        const sel = document.getElementById('export-resolution');
        sel.value = value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (panelId === 'new-export-fps-panel') {
        document.getElementById('new-fps-value').textContent = label;
        const sel = document.getElementById('export-fps');
        sel.value = value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (panelId === 'new-font-family-panel') {
        document.getElementById('new-font-family-value').textContent = label;
        const sel = document.getElementById('sel-fontFamily');
        sel.value = value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (panelId === 'new-font-weight-panel') {
        document.getElementById('new-font-weight-value').textContent = label;
        const sel = document.getElementById('sel-fontWeight');
        sel.value = value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (panelId === 'new-text-position-panel') {
        document.getElementById('new-text-position-value').textContent = label;
        const sel = document.getElementById('sel-textPosition');
        sel.value = value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    panel.classList.remove('open');
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.new-export-dropdown')) {
        document.querySelectorAll('.new-export-dropdown').forEach(p => p.classList.remove('open'));
    }
});

// ============================================================
//  INIT
// ============================================================
(function init() {
    buildPaletteGrid();
    buildSpeedButtons();
    buildBorderGrid();
    buildFilterGrid();
    initSwitches();
    initSliders();
    initSelects();
    initHardcodedSegGroups();
    initColorInputs();
    applyColors();
    applyLang();

    // Set initial canvas container size
    const area = document.getElementById('canvas-area');
    const container = document.getElementById('canvas-container');
    const w = area.clientWidth - 32;
    const h = w * (9/16);
    const areaH = area.clientHeight - 80;
    const finalH = Math.min(h, areaH);
    const finalW = finalH * (16/9);
    container.style.width  = Math.min(finalW, w) + 'px';
    container.style.height = Math.min(finalH, areaH) + 'px';

    // Watch for window resize to update canvas container
    window.addEventListener('resize', () => {
        const aW = area.clientWidth - 32, aH = area.clientHeight - 80;
        if (tracker.onVideoLoad && canvas.width > 0 && canvas.height > 0) {
            // Video loaded: resize to match video aspect ratio
            const aspect = canvas.width / canvas.height;
            let w2 = aW, h2 = aW / aspect;
            if (h2 > aH) { h2 = aH; w2 = aH * aspect; }
            container.style.width  = w2 + 'px';
            container.style.height = h2 + 'px';
        } else {
            // No video loaded: maintain 16:9 placeholder
            const defaultW = aW;
            const defaultH = defaultW * (9/16);
            const finalDefaultH = Math.min(defaultH, aH);
            const finalDefaultW = finalDefaultH * (16/9);
            container.style.width  = Math.min(finalDefaultW, defaultW) + 'px';
            container.style.height = Math.min(finalDefaultH, aH) + 'px';
        }
    });
})();

// ============================================================
//  超规格视频弹窗逻辑
//  window._showOverspecModal(w, h, fps) → Promise<'4k30'|'1080p60'|'cancel'>
//  弹窗期间禁用所有页面交互，用户选择后 resolve。
// ============================================================
window._showOverspecModal = function(w, h, fps) {
    return new Promise((resolve) => {
        try {
            const overlay = document.getElementById('overspec-overlay');
            const specEl  = document.getElementById('overspec-modal-spec');
            const btn4k   = document.getElementById('overspec-btn-4k');
            const btn1080 = document.getElementById('overspec-btn-1080');
            const btnCancel = document.getElementById('overspec-btn-cancel');

            if (!overlay) { resolve('cancel'); return; }

            // 填充规格信息
            const fpsStr = (Math.round(fps * 100) / 100).toFixed(2);
            specEl.textContent = w + ' × ' + h + '  |  ' + fpsStr + ' fps';

            // 主按钮1 同步主题色（复用 getUiColor）
            try {
                const uiC = (typeof getUiColor === 'function') ? getUiColor() : '#ffffff';
                btn4k.style.background = uiC;
                btn4k.style.color = '#000';
                btn4k.style.boxShadow = '0 4px 20px ' + uiC + '40';
            } catch(_) {}

            // 禁用页面交互
            document.getElementById('app-root').style.pointerEvents = 'none';

            // 显示弹窗
            overlay.classList.add('visible');

            let settled = false;
            const finish = (choice) => {
                if (settled) return;
                settled = true;
                overlay.classList.remove('visible');
                // 300ms 后恢复交互（等动画结束）
                setTimeout(() => {
                    document.getElementById('app-root').style.pointerEvents = '';
                }, 320);
                resolve(choice);
            };

            // 点击遮罩 = 取消
            const onOverlay = (e) => {
                if (e.target === overlay) { cleanup(); finish('cancel'); }
            };
            const on4k     = () => { cleanup(); finish('4k30'); };
            const on1080   = () => { cleanup(); finish('1080p60'); };
            const onCancel = () => { cleanup(); finish('cancel'); };

            const cleanup = () => {
                overlay.removeEventListener('click', onOverlay);
                btn4k.removeEventListener('click', on4k);
                btn1080.removeEventListener('click', on1080);
                btnCancel.removeEventListener('click', onCancel);
            };

            overlay.addEventListener('click', onOverlay);
            btn4k.addEventListener('click', on4k);
            btn1080.addEventListener('click', on1080);
            btnCancel.addEventListener('click', onCancel);

        } catch(err) {
            console.error('[OverspecModal] 弹窗异常:', err);
            resolve('cancel');
        }
    });
};

// ============================================================
//  导出确认弹窗
//  window._showExportConfirmModal(originalInfo, clampedInfo) → Promise<'ok'|'cancel'>
//  弹窗期间禁用所有页面交互，用户选择后 resolve。
// ============================================================
window._showExportConfirmModal = function(originalInfo, clampedInfo) {
    return new Promise((resolve) => {
        try {
            const overlay = document.getElementById('export-confirm-overlay');
            const specEl  = document.getElementById('export-confirm-spec');
            const btnOk   = document.getElementById('export-confirm-btn-ok');
            const btnCancel = document.getElementById('export-confirm-btn-cancel');

            if (!overlay) { resolve('cancel'); return; }

            // 填充规格信息
            const origFpsStr = Number.isInteger(originalInfo.fps)
                ? String(originalInfo.fps)
                : originalInfo.fps.toFixed(3);
            const clampFpsStr = Number.isInteger(clampedInfo.fps)
                ? String(clampedInfo.fps)
                : clampedInfo.fps.toFixed(3);
            
            specEl.textContent = [
                '原视频规格：',
                '  分辨率：' + originalInfo.width + ' x ' + originalInfo.height,
                '  帧率：' + origFpsStr + ' fps',
                '',
                '实际导出规格：',
                '  分辨率：' + clampedInfo.width + ' x ' + clampedInfo.height,
                '  帧率：' + clampFpsStr + ' fps'
            ].join('\n');

            // 主按钮同步主题色（复用 getUiColor）
            try {
                const uiC = (typeof getUiColor === 'function') ? getUiColor() : '#ffffff';
                btnOk.style.background = uiC;
                btnOk.style.color = '#000';
                btnOk.style.boxShadow = '0 4px 20px ' + uiC + '40';
            } catch(_) {}

            // 禁用页面交互
            document.getElementById('app-root').style.pointerEvents = 'none';

            // 显示弹窗
            overlay.classList.add('visible');

            let settled = false;
            const finish = (choice) => {
                if (settled) return;
                settled = true;
                overlay.classList.remove('visible');
                // 300ms 后恢复交互（等动画结束）
                setTimeout(() => {
                    document.getElementById('app-root').style.pointerEvents = '';
                }, 320);
                resolve(choice);
            };

            // 点击遮罩 = 取消
            const onOverlay = (e) => {
                if (e.target === overlay) { cleanup(); finish('cancel'); }
            };
            const onOk     = () => { cleanup(); finish('ok'); };
            const onCancelBtn = () => { cleanup(); finish('cancel'); };

            const cleanup = () => {
                overlay.removeEventListener('click', onOverlay);
                btnOk.removeEventListener('click', onOk);
                btnCancel.removeEventListener('click', onCancelBtn);
            };

            overlay.addEventListener('click', onOverlay);
            btnOk.addEventListener('click', onOk);
            btnCancel.addEventListener('click', onCancelBtn);

        } catch(err) {
            console.error('[ExportConfirmModal] 弹窗异常:', err);
            resolve('cancel');
        }
    });
};

// ============================================================
//  按钮动态发光效果
// ============================================================
function setupGlowEffect() {
    const buttons = document.querySelectorAll('.action-btn, .export-btn, .seg-btn, .speed-btn, .new-dropdown-selector');
    
    glowEffectListeners.forEach(item => {
        item.button.removeEventListener('mouseenter', item.onMouseEnter);
        item.button.removeEventListener('mousemove', item.onMouseMove);
        item.button.removeEventListener('mouseleave', item.onMouseLeave);
    });
    glowEffectListeners = [];
    
    buttons.forEach(button => {
        let rafId = null;
        
        const onMouseEnter = () => {
            button.style.setProperty('--glow-x', '50%');
            button.style.setProperty('--glow-y', '50%');
        };
        
        const onMouseMove = (e) => {
            if (rafId) return;
            
            rafId = requestAnimationFrame(() => {
                const rect = button.getBoundingClientRect();
                const x = ((e.clientX - rect.left) / rect.width) * 100;
                const y = ((e.clientY - rect.top) / rect.height) * 100;
                
                button.style.setProperty('--glow-x', `${x}%`);
                button.style.setProperty('--glow-y', `${y}%`);
                
                rafId = null;
            });
        };
        
        const onMouseLeave = () => {
            if (rafId) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
        };
        
        button.addEventListener('mouseenter', onMouseEnter);
        button.addEventListener('mousemove', onMouseMove);
        button.addEventListener('mouseleave', onMouseLeave);
        
        glowEffectListeners.push({
            button,
            onMouseEnter,
            onMouseMove,
            onMouseLeave
        });
    });
}

setupGlowEffect();
