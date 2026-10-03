// Creative Code
    {
      // @clay-no-bg-control
const ctx = canvas.getContext('2d');

// WebGL Thermal SDF Fragment Shader Source
const vsSource = `#version 300 es
in vec2 a_position;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const fsSource = `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2 u_resolution;
uniform vec2 u_chartOffset;
uniform float u_time;
uniform int u_mode; // 0 = petal, 1 = concentric, 2 = bubble
uniform int u_activeCount;
uniform float u_chartScale;
uniform float u_centerCutoutR;
uniform float u_sminK;
uniform float u_segmentSoftness;
uniform float u_bgNoise;      // Background noise intensity [0..1]
uniform float u_segmentNoise; // Segment interior noise intensity [0..1]
uniform int u_enableHeatmap;  // 1 = Thermal Heatmap View, 0 = Clean Flat View

// Heatmap View (Isoline background) uniforms
uniform int u_heatmapView;   // 1 = Isoline Heatmap View active, 0 = Standard
uniform float u_waveLayers;  // frequency of isoline rings
uniform float u_waveSpread;  // max distance in pixels
uniform float u_waveFalloff; // power falloff exponent
uniform int u_animateWaves;  // 1 = phase offset moves over time
uniform vec3 u_isoColor0;    // 5-color palette stops (hot to cold)
uniform vec3 u_isoColor1;
uniform vec3 u_isoColor2;
uniform vec3 u_isoColor3;
uniform vec3 u_isoColor4;

// Seamless Looping Animated Background Gradient uniforms
uniform int u_enableGradient;
uniform vec3 u_gradientColor1;
uniform vec3 u_gradientColor2;
uniform vec3 u_gradientColor3;
uniform float u_gradientSpeed;

// Node data arrays (up to 15 nodes)
uniform vec2 u_nodePos[15];     // position relative to center (canvas pixels)
uniform float u_nodeVal[15];    // node value [0..100]
uniform float u_nodeOuterR[15]; // outer radius / extent
uniform float u_nodeInnerR[15]; // inner radius
uniform float u_nodeStartA[15]; // start angle
uniform float u_nodeEndA[15];   // end angle
uniform float u_nodeCornerR[15];// corner radius
uniform float u_nodeActive[15]; // active weight [0..1]
uniform vec3 u_nodeColor[15];   // segment color for flat mode

// Multi-stop Thermal Spectrum Colors
uniform vec3 u_bgColor;
uniform vec3 u_colorEdge; // soft orange/coral #FFA472
uniform vec3 u_colorLow;  // purple/magenta #B088F9
uniform vec3 u_colorMid;  // electric cyan #00E5FF
uniform vec3 u_colorHigh; // neon yellow #FFFFB3
uniform vec3 u_colorCore; // peak white #FFFFFF

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float smax(float a, float b, float k) {
    return -smin(-a, -b, k);
}

float sdCircle(vec2 p, vec2 center, float r) {
    return length(p - center) - r;
}

float sdRoundedArcSector(vec2 p, float startA, float endA, float innerR, float outerR, float cornerR) {
    float midA = (startA + endA) * 0.5;
    float halfSweep = abs(endA - startA) * 0.5;
    
    float cosM = cos(-midA);
    float sinM = sin(-midA);
    vec2 pRot = vec2(p.x * cosM - p.y * sinM, p.x * sinM + p.y * cosM);
    vec2 p2 = vec2(pRot.x, abs(pRot.y));
    
    float maxCornerR = min((outerR - innerR) * 0.48, innerR * sin(halfSweep) * 0.9);
    float rc = clamp(cornerR, 0.0, max(0.0, maxCornerR));
    
    if (rc < 0.2) {
        float r = length(p2);
        vec2 u = vec2(cos(halfSweep), sin(halfSweep));
        vec2 n = vec2(-sin(halfSweep), cos(halfSweep));
        float proj = dot(p2, u);
        float perp = dot(p2, n);
        
        if (perp <= 0.0) {
            return max(r - outerR, innerR - r);
        } else {
            if (proj >= outerR) return length(p2 - u * outerR);
            if (proj <= innerR) return length(p2 - u * innerR);
            return perp;
        }
    }
    
    float outR_in = outerR - rc;
    float inR_in = innerR + rc;
    
    float sinOut = clamp(rc / max(1.0, outR_in), 0.0, 0.98);
    float sinIn = clamp(rc / max(1.0, inR_in), 0.0, 0.98);
    float aOut = halfSweep - asin(sinOut);
    float aIn = halfSweep - asin(sinIn);
    
    vec2 cOut = vec2(cos(aOut), sin(aOut)) * outR_in;
    vec2 cIn = vec2(cos(aIn), sin(aIn)) * inR_in;
    
    vec2 uSide = cOut - cIn;
    float sideLen = length(uSide);
    if (sideLen < 0.001) return length(p2 - cOut) - rc;
    uSide /= sideLen;
    
    vec2 nSide = vec2(-uSide.y, uSide.x);
    
    float perpSide = dot(p2 - cIn, nSide);
    float projSide = dot(p2 - cIn, uSide);
    
    float dInset = 0.0;
    
    if (perpSide <= 0.0) {
        float r = length(p2);
        dInset = max(max(r - outR_in, inR_in - r), perpSide);
    } else {
        if (projSide <= 0.0) {
            dInset = length(p2 - cIn);
        } else if (projSide >= sideLen) {
            dInset = length(p2 - cOut);
        } else {
            dInset = perpSide;
        }
    }
    
    return dInset - rc;
}

vec3 sampleIsolinePalette(float t) {
    t = clamp(t, 0.0, 1.0);
    if (t < 0.25) {
        return mix(u_isoColor0, u_isoColor1, t / 0.25);
    } else if (t < 0.50) {
        return mix(u_isoColor1, u_isoColor2, (t - 0.25) / 0.25);
    } else if (t < 0.75) {
        return mix(u_isoColor2, u_isoColor3, (t - 0.50) / 0.25);
    } else {
        return mix(u_isoColor3, u_isoColor4, (t - 0.75) / 0.25);
    }
}

void main() {
    vec2 p = vec2(gl_FragCoord.x - u_resolution.x * 0.5, u_resolution.y * 0.5 - gl_FragCoord.y);
    vec2 pChart = p - u_chartOffset;
    float distToCenter = length(pChart);
    
    // Static pseudo-random film grain noise
    float noiseRaw = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5);

    // --- STEP 1..4: SEAMLESS LOOPING ANIMATED GRADIENT & RADIAL AURA BACKGROUND ---
    vec3 currentBgColor = u_bgColor;
    if (u_enableGradient == 1) {
        // Step 2 Linear Gradient: phase & rotation angle
        float phase = u_time * 0.35 * (u_gradientSpeed / 6.0);
        float angle = phase * 0.6;
        
        vec2 pCanvas = gl_FragCoord.xy;
        vec2 center = u_resolution * 0.5;
        vec2 dir = vec2(cos(angle), sin(angle));
        
        float diag = length(u_resolution) * 0.58;
        float proj = dot(pCanvas - center, dir);
        float normT = clamp((proj / diag) * 0.5 + 0.5, 0.0, 1.0);
        
        // 8 discrete stops interpolated cyclically across [c1, c2, c3]
        float stopIndex = normT * 7.0;
        float cyclicPos = mod(stopIndex + phase * 3.0, 3.0);
        vec3 gradCol = vec3(0.0);
        if (cyclicPos < 1.0) {
            gradCol = mix(u_gradientColor1, u_gradientColor2, cyclicPos);
        } else if (cyclicPos < 2.0) {
            gradCol = mix(u_gradientColor2, u_gradientColor3, cyclicPos - 1.0);
        } else {
            gradCol = mix(u_gradientColor3, u_gradientColor1, cyclicPos - 2.0);
        }
        currentBgColor = mix(u_bgColor, gradCol, 0.88);
        
        // Step 3 Radial Auras
        float maxDim = max(u_resolution.x, u_resolution.y);
        
        // Aura 1
        vec2 aura1Center = vec2(
            center.x + cos(phase * 1.35) * u_resolution.x * 0.28,
            center.y + sin(phase * 1.1) * u_resolution.y * 0.25
        );
        float dist1 = length(pCanvas - aura1Center) / (maxDim * 0.72);
        if (dist1 < 1.0) {
            float f1 = pow(1.0 - dist1, 1.8) * 0.55;
            currentBgColor = mix(currentBgColor, u_gradientColor2, f1);
        }
        
        // Aura 2
        vec2 aura2Center = vec2(
            center.x + sin(phase * 0.95 + 1.8) * u_resolution.x * 0.26,
            center.y + cos(phase * 1.25 + 0.9) * u_resolution.y * 0.23
        );
        float dist2 = length(pCanvas - aura2Center) / (maxDim * 0.65);
        if (dist2 < 1.0) {
            float f2 = pow(1.0 - dist2, 1.8) * 0.45;
            currentBgColor = mix(currentBgColor, u_gradientColor3, f2);
        }
        
        // Step 4 Vignette
        float distCenterNorm = length((pCanvas - center) / (maxDim * 0.70));
        float vignetteAlpha = mix(0.05, 0.50, clamp(distCenterNorm * distCenterNorm, 0.0, 1.0));
        currentBgColor = mix(currentBgColor, vec3(0.0), vignetteAlpha);
    }

    if (u_heatmapView == 0 && u_enableHeatmap == 0) {
        // Apply background noise exclusively outside
        vec3 bgWithNoise = clamp(currentBgColor + vec3(noiseRaw) * u_bgNoise * 0.25, 0.0, 1.0);
        fragColor = vec4(bgWithNoise, 1.0);
        return;
    }

    float dField = 1e5;
    float tempValField = 0.0;
    
    float scale = max(0.5, u_chartScale);
    float k = (u_mode == 0) ? (3.0 * scale) : u_sminK;

    for (int i = 0; i < 15; i++) {
        if (i >= u_activeCount) break;
        if (u_nodeActive[i] <= 0.001) continue;
        
        float valNorm = clamp(u_nodeVal[i] / 100.0, 0.0, 1.25);
        float dNode = 1e5;
        vec2 nodeC = u_nodePos[i];
        
        float iF = float(i);
        float fluidAmp = 2.8 * scale * (0.5 + 0.5 * valNorm);
        float pAng = atan(pChart.y, pChart.x);
        float pDist = length(pChart);
        vec2 pFluid = pChart + vec2(
            sin(pChart.y * 0.02 + u_time * 1.3 + iF * 1.7 + sin(pAng * 3.0 + u_time * 0.9)),
            cos(pChart.x * 0.02 + u_time * 1.1 + iF * 2.3 + cos(pDist * 0.03 - u_time * 0.8))
        ) * fluidAmp;

        if (u_mode == 0) { // Petal Mode
            dNode = sdRoundedArcSector(pFluid, u_nodeStartA[i], u_nodeEndA[i], u_nodeInnerR[i], u_nodeOuterR[i], u_nodeCornerR[i]);
            
            float midA = (u_nodeStartA[i] + u_nodeEndA[i]) * 0.5;
            vec2 dir = vec2(cos(midA), sin(midA));
            float midR = (u_nodeInnerR[i] + u_nodeOuterR[i]) * 0.5;
            vec2 corePos = dir * midR;
            float distToCore = length(pFluid - corePos);
            float coreRadius = max(10.0 * scale, (u_nodeOuterR[i] - u_nodeInnerR[i]) * 0.45) * (0.65 + 0.65 * u_segmentSoftness);
            float falloffPower = max(0.8, 2.2 / max(0.3, u_segmentSoftness));
            
            float tContrib = valNorm * (1.0 / (1.0 + pow(distToCore / coreRadius, falloffPower)));
            tempValField = max(tempValField, tContrib);
            
        } else if (u_mode == 1) { // Concentric Mode
            dNode = sdRoundedArcSector(pFluid, u_nodeStartA[i], u_nodeEndA[i], u_nodeInnerR[i], u_nodeOuterR[i], u_nodeCornerR[i]);
            
            float rMid = (u_nodeInnerR[i] + u_nodeOuterR[i]) * 0.5;
            float trackWidth = u_nodeOuterR[i] - u_nodeInnerR[i];
            float a = atan(pFluid.y, pFluid.x);
            float dAngle = mod(a - u_nodeStartA[i], 6.28318530718);
            float currSweep = max(0.001, u_nodeEndA[i] - u_nodeStartA[i]);
            float gapMid = 3.14159265359 + currSweep * 0.5;
            if (dAngle > gapMid) {
                dAngle -= 6.28318530718;
            }
            float clampedAngleOffset = clamp(dAngle, 0.0, currSweep);
            float clampedA = u_nodeStartA[i] + clampedAngleOffset;
            vec2 arcPt = vec2(cos(clampedA), sin(clampedA)) * rMid;
            float distToArc = length(pFluid - arcPt);
            
            float coreRadius = max(6.0 * scale, trackWidth * 0.4) * (0.65 + 0.65 * u_segmentSoftness);
            float falloffPower = max(0.8, 2.2 / max(0.3, u_segmentSoftness));
            float tContrib = valNorm * (1.0 / (1.0 + pow(distToArc / coreRadius, falloffPower)));
            tempValField = max(tempValField, tContrib);
            
        } else { // Bubble Mode
            float r = max(4.0, u_nodeOuterR[i]);
            dNode = sdCircle(pFluid, nodeC, r);
            
            float distToC = length(pFluid - nodeC);
            float tContrib = valNorm * (1.0 / (1.0 + pow(distToC / max(1.0, r * 1.1 * u_segmentSoftness), 2.0)));
            tempValField = max(tempValField, tContrib);
        }
        
        dField = smin(dField, dNode, k);
    }
    
    if (u_mode != 2 && u_centerCutoutR > 0.1) {
        float dVoid = distToCenter - u_centerCutoutR;
        dField = smax(dField, -dVoid, 8.0 * scale);
    }

    // --- MODE A: ISOLINE HEATMAP VIEW (BACKGROUND THERMAL WAVES) ---
    if (u_heatmapView == 1) {
        float distToEdge = abs(dField);
        float maxSpread = max(20.0, u_waveSpread * scale);
        
        if (distToEdge < maxSpread) {
            float normD = distToEdge / maxSpread; // 0 at contour, 1 at maxSpread
            
            float tempFalloff = pow(1.0 - normD, u_waveFalloff);
            float phase = (u_animateWaves == 1) ? (u_time * 2.2) : 0.0;
            float waveCycles = u_waveLayers;
            float wavePattern = 0.5 + 0.5 * cos(normD * waveCycles * 6.2831853 - phase);
            float ringLine = smoothstep(0.82, 0.98, wavePattern);
            
            vec3 isoCol = sampleIsolinePalette(normD);
            float waveIntensity = tempFalloff * (0.35 + 0.65 * wavePattern);
            vec3 waveColor = isoCol * (0.55 + 0.45 * wavePattern) + vec3(1.0) * ringLine * tempFalloff * 0.25;
            
            // Background noise applied to background waves
            waveColor += vec3(noiseRaw) * u_bgNoise * 0.18 * tempFalloff;
            float alpha = clamp(waveIntensity * 0.88, 0.0, 0.95);
            
            if (dField < 0.0) {
                float interiorAlpha = smoothstep(1.5, -1.5, dField);
                vec3 neutralShapeColor = mix(currentBgColor * 0.35, vec3(0.08, 0.09, 0.12), 0.85);
                // Apply segment noise inside neutral shape
                neutralShapeColor += vec3(noiseRaw) * u_segmentNoise * 0.15;
                
                float edgeStroke = smoothstep(2.5, 0.5, abs(dField));
                vec3 finalShapeColor = mix(neutralShapeColor, u_isoColor0, edgeStroke * 0.8);
                
                vec3 blendedCol = mix(waveColor, finalShapeColor, interiorAlpha);
                float blendedAlpha = max(alpha, interiorAlpha * 0.92);
                fragColor = vec4(blendedCol * blendedAlpha, blendedAlpha);
            } else {
                fragColor = vec4(waveColor * alpha, alpha);
            }
            return;
        } else if (dField < 0.0) {
            vec3 neutralShapeColor = mix(currentBgColor * 0.35, vec3(0.08, 0.09, 0.12), 0.85);
            neutralShapeColor += vec3(noiseRaw) * u_segmentNoise * 0.15;
            fragColor = vec4(neutralShapeColor * 0.92, 0.92);
            return;
        }
        
        vec3 bgWithNoise = clamp(currentBgColor + vec3(noiseRaw) * u_bgNoise * 0.25, 0.0, 1.0);
        fragColor = vec4(bgWithNoise, 1.0);
        return;
    }

    // --- MODE B: STANDARD INTERNAL THERMAL HEATMAP ---
    float blurRadius = 22.0 * scale * max(0.1, u_segmentSoftness);
    float hShape = smoothstep(blurRadius, -blurRadius * 0.5, dField);
    
    // Segment noise applies exclusively inside segment shape (dField <= 0)
    float segNoiseContrib = (dField <= 0.0) ? (noiseRaw * u_segmentNoise * 0.15 * hShape) : 0.0;
    float intensity = clamp(hShape * (0.15 + 0.85 * tempValField) + segNoiseContrib, 0.0, 1.0);
    
    if (intensity <= 0.0001) {
        vec3 bgWithNoise = clamp(currentBgColor + vec3(noiseRaw) * u_bgNoise * 0.25, 0.0, 1.0);
        fragColor = vec4(bgWithNoise, 1.0);
        return;
    }
    
    float t = clamp(intensity, 0.0, 1.0);
    float alpha = smoothstep(0.0, 0.16, t);
    vec3 col = u_colorEdge;
    
    if (t < 0.22) {
        float f = t / 0.22;
        col = mix(u_colorEdge, u_colorLow, f);
    } else if (t < 0.48) {
        float f = (t - 0.22) / 0.26;
        col = mix(u_colorLow, u_colorMid, f);
    } else if (t < 0.75) {
        float f = (t - 0.48) / 0.27;
        col = mix(u_colorMid, u_colorHigh, f);
    } else {
        float f = (t - 0.75) / 0.25;
        col = mix(u_colorHigh, u_colorCore, f);
    }
    
    vec3 grain = vec3(noiseRaw) * u_segmentNoise * 0.25 * (0.25 + 0.75 * intensity);
    col = clamp(col + grain, 0.0, 1.0);
    
    // Composite over background
    vec3 finalComposite = mix(currentBgColor + vec3(noiseRaw) * u_bgNoise * 0.15, col, alpha);
    fragColor = vec4(finalComposite, 1.0);
}
`;

// Offscreen WebGL Context & Shader Pipeline
let glCanvas = null;
let gl = null;
let glProgram = null;
let glUniforms = {};

function initWebGL() {
  try {
    glCanvas = document.createElement('canvas');
    gl = glCanvas.getContext('webgl2', { alpha: true, antialias: true });
    if (!gl) return false;

    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);

    glProgram = gl.createProgram();
    gl.attachShader(glProgram, vs);
    gl.attachShader(glProgram, fs);
    gl.linkProgram(glProgram);

    if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) {
      console.error('Program Link Error:', gl.getProgramInfoLog(glProgram));
      return false;
    }

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1,
    ]), gl.STATIC_DRAW);

    const aPosition = gl.getAttribLocation(glProgram, 'a_position');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    glUniforms = {
      u_resolution: gl.getUniformLocation(glProgram, 'u_resolution'),
      u_chartOffset: gl.getUniformLocation(glProgram, 'u_chartOffset'),
      u_time: gl.getUniformLocation(glProgram, 'u_time'),
      u_mode: gl.getUniformLocation(glProgram, 'u_mode'),
      u_activeCount: gl.getUniformLocation(glProgram, 'u_activeCount'),
      u_chartScale: gl.getUniformLocation(glProgram, 'u_chartScale'),
      u_centerCutoutR: gl.getUniformLocation(glProgram, 'u_centerCutoutR'),
      u_sminK: gl.getUniformLocation(glProgram, 'u_sminK'),
      u_segmentSoftness: gl.getUniformLocation(glProgram, 'u_segmentSoftness'),
      u_bgNoise: gl.getUniformLocation(glProgram, 'u_bgNoise'),
      u_segmentNoise: gl.getUniformLocation(glProgram, 'u_segmentNoise'),
      u_enableHeatmap: gl.getUniformLocation(glProgram, 'u_enableHeatmap'),

      u_heatmapView: gl.getUniformLocation(glProgram, 'u_heatmapView'),
      u_waveLayers: gl.getUniformLocation(glProgram, 'u_waveLayers'),
      u_waveSpread: gl.getUniformLocation(glProgram, 'u_waveSpread'),
      u_waveFalloff: gl.getUniformLocation(glProgram, 'u_waveFalloff'),
      u_animateWaves: gl.getUniformLocation(glProgram, 'u_animateWaves'),
      u_isoColor0: gl.getUniformLocation(glProgram, 'u_isoColor0'),
      u_isoColor1: gl.getUniformLocation(glProgram, 'u_isoColor1'),
      u_isoColor2: gl.getUniformLocation(glProgram, 'u_isoColor2'),
      u_isoColor3: gl.getUniformLocation(glProgram, 'u_isoColor3'),
      u_isoColor4: gl.getUniformLocation(glProgram, 'u_isoColor4'),

      u_enableGradient: gl.getUniformLocation(glProgram, 'u_enableGradient'),
      u_gradientColor1: gl.getUniformLocation(glProgram, 'u_gradientColor1'),
      u_gradientColor2: gl.getUniformLocation(glProgram, 'u_gradientColor2'),
      u_gradientColor3: gl.getUniformLocation(glProgram, 'u_gradientColor3'),
      u_gradientSpeed: gl.getUniformLocation(glProgram, 'u_gradientSpeed'),
      u_colorCore: gl.getUniformLocation(glProgram, 'u_colorCore'),
      u_colorHigh: gl.getUniformLocation(glProgram, 'u_colorHigh'),
      u_colorMid: gl.getUniformLocation(glProgram, 'u_colorMid'),
      u_colorLow: gl.getUniformLocation(glProgram, 'u_colorLow'),
      u_colorEdge: gl.getUniformLocation(glProgram, 'u_colorEdge'),
      u_bgColor: gl.getUniformLocation(glProgram, 'u_bgColor'),
    };

    for (let i = 0; i < 15; i++) {
      glUniforms[`u_nodePos[${i}]`] = gl.getUniformLocation(glProgram, `u_nodePos[${i}]`);
      glUniforms[`u_nodeVal[${i}]`] = gl.getUniformLocation(glProgram, `u_nodeVal[${i}]`);
      glUniforms[`u_nodeOuterR[${i}]`] = gl.getUniformLocation(glProgram, `u_nodeOuterR[${i}]`);
      glUniforms[`u_nodeInnerR[${i}]`] = gl.getUniformLocation(glProgram, `u_nodeInnerR[${i}]`);
      glUniforms[`u_nodeStartA[${i}]`] = gl.getUniformLocation(glProgram, `u_nodeStartA[${i}]`);
      glUniforms[`u_nodeEndA[${i}]`] = gl.getUniformLocation(glProgram, `u_nodeEndA[${i}]`);
      glUniforms[`u_nodeCornerR[${i}]`] = gl.getUniformLocation(glProgram, `u_nodeCornerR[${i}]`);
      glUniforms[`u_nodeActive[${i}]`] = gl.getUniformLocation(glProgram, `u_nodeActive[${i}]`);
      glUniforms[`u_nodeColor[${i}]`] = gl.getUniformLocation(glProgram, `u_nodeColor[${i}]`);
    }

    return true;
  } catch (e) {
    console.error('WebGL init error:', e);
    return false;
  }
}

initWebGL();

const ISOLINE_PALETTES = {
  thermal: ['#FFE600', '#FF7700', '#E6007E', '#2B4CDE', '#00E5FF'],
  cyber: ['#FF007F', '#A100FF', '#0033FF', '#00F0FF', '#E0FFFF'],
  ocean: ['#FFFFFF', '#00E5FF', '#00A89C', '#0D47A1', '#030F26'],
  neon: ['#CCFF00', '#FFEE00', '#FF0099', '#00E5FF', '#2A004E'],
  sunset: ['#FFF7ED', '#FDE047', '#F97316', '#991B1B', '#2A0404']
};

function parseColorToVec3(colorInput, defaultVec = [1, 1, 1]) {
  if (!colorInput) return defaultVec;
  let str = '';
  if (typeof colorInput === 'string') {
    str = colorInput.trim();
  } else if (typeof colorInput === 'object' && colorInput !== null) {
    if (typeof colorInput.r === 'number' && typeof colorInput.g === 'number' && typeof colorInput.b === 'number') {
      return [
        Math.max(0, Math.min(1, colorInput.r > 1 ? colorInput.r / 255 : colorInput.r)),
        Math.max(0, Math.min(1, colorInput.g > 1 ? colorInput.g / 255 : colorInput.g)),
        Math.max(0, Math.min(1, colorInput.b > 1 ? colorInput.b / 255 : colorInput.b))
      ];
    }
    if (typeof colorInput.hex === 'string') str = colorInput.hex.trim();
    else if (typeof colorInput.color === 'string') str = colorInput.color.trim();
    else if (typeof colorInput.value === 'string') str = colorInput.value.trim();
    else if (typeof colorInput.str === 'string') str = colorInput.str.trim();
  }

  if (!str) return defaultVec;

  if (str.startsWith('rgb') || str.startsWith('hsl')) {
    const match = str.match(/(?:rgba?|hsla?)\(\s*([\d.]+)\s*,\s*([\d.%]+)\s*,\s*([\d.%]+)/i);
    if (match) {
      const r = parseFloat(match[1]) / (parseFloat(match[1]) > 1 ? 255 : 1);
      const g = parseFloat(match[2]) / (parseFloat(match[2]) > 1 ? 255 : 1);
      const b = parseFloat(match[3]) / (parseFloat(match[3]) > 1 ? 255 : 1);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        return [Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b))];
      }
    }
  }

  let h = str.replace('#', '').trim();
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  } else if (h.length === 4) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }

  if (h.length >= 6) {
    const r = parseInt(h.substring(0, 2), 16) / 255;
    const g = parseInt(h.substring(2, 4), 16) / 255;
    const b = parseInt(h.substring(4, 6), 16) / 255;
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
      return [Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b))];
    }
  }

  try {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = tempCanvas.height = 1;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.fillStyle = str;
    tempCtx.fillRect(0, 0, 1, 1);
    const data = tempCtx.getImageData(0, 0, 1, 1).data;
    return [data[0] / 255, data[1] / 255, data[2] / 255];
  } catch (e) {}

  return defaultVec;
}

function hexToVec3(hex, defaultVec = [1, 1, 1]) {
  return parseColorToVec3(hex, defaultVec);
}

function parseColorToRgba(colorInput, alphaOverride = 1.0) {
  if (!colorInput) return `rgba(255, 255, 255, ${alphaOverride})`;

  let str = '';
  let extractedAlpha = null;

  if (typeof colorInput === 'object' && colorInput !== null) {
    if (typeof colorInput.a === 'number') extractedAlpha = colorInput.a;
    else if (typeof colorInput.alpha === 'number') extractedAlpha = colorInput.alpha;
    else if (typeof colorInput.opacity === 'number') extractedAlpha = colorInput.opacity;

    if (typeof colorInput.r === 'number' && typeof colorInput.g === 'number' && typeof colorInput.b === 'number') {
      const r = Math.round(colorInput.r > 1 ? colorInput.r : colorInput.r * 255);
      const g = Math.round(colorInput.g > 1 ? colorInput.g : colorInput.g * 255);
      const b = Math.round(colorInput.b > 1 ? colorInput.b : colorInput.b * 255);
      const finalA = (extractedAlpha !== null ? extractedAlpha : 1.0) * alphaOverride;
      return `rgba(${r}, ${g}, ${b}, ${finalA})`;
    }

    if (typeof colorInput.hex === 'string') str = colorInput.hex.trim();
    else if (typeof colorInput.color === 'string') str = colorInput.color.trim();
    else if (typeof colorInput.value === 'string') str = colorInput.value.trim();
    else if (typeof colorInput.str === 'string') str = colorInput.str.trim();
  } else if (typeof colorInput === 'string') {
    str = colorInput.trim();
  }

  if (!str) return `rgba(255, 255, 255, ${alphaOverride})`;

  if (str.startsWith('rgb') || str.startsWith('hsl')) {
    const match = str.match(/(?:rgba?|hsla?)\(\s*([\d.]+)\s*,\s*([\d.%]+)\s*,\s*([\d.%]+)(?:\s*,\s*([\d.]+))?/i);
    if (match) {
      if (str.startsWith('hsl')) {
        try {
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = tempCanvas.height = 1;
          const tempCtx = tempCanvas.getContext('2d');
          tempCtx.fillStyle = str;
          tempCtx.fillRect(0, 0, 1, 1);
          const data = tempCtx.getImageData(0, 0, 1, 1).data;
          const strA = match[4] !== undefined ? parseFloat(match[4]) : 1.0;
          const finalA = (extractedAlpha !== null ? extractedAlpha : strA) * alphaOverride;
          return `rgba(${data[0]}, ${data[1]}, ${data[2]}, ${finalA})`;
        } catch (e) {}
      } else {
        const r = Math.round(parseFloat(match[1]));
        const g = Math.round(parseFloat(match[2]));
        const b = Math.round(parseFloat(match[3]));
        const strA = match[4] !== undefined ? parseFloat(match[4]) : 1.0;
        const finalA = (extractedAlpha !== null ? extractedAlpha : strA) * alphaOverride;
        return `rgba(${r}, ${g}, ${b}, ${finalA})`;
      }
    }
  }

  let h = str.replace('#', '').trim();
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  } else if (h.length === 4) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }

  if (h.length >= 6) {
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    let hexA = 1.0;
    if (h.length >= 8) {
      const parsedA = parseInt(h.substring(6, 8), 16);
      if (!isNaN(parsedA)) hexA = parsedA / 255;
    }
    const finalA = (extractedAlpha !== null ? extractedAlpha : hexA) * alphaOverride;
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
      return `rgba(${r}, ${g}, ${b}, ${finalA})`;
    }
  }

  try {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = tempCanvas.height = 1;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.fillStyle = str;
    tempCtx.fillRect(0, 0, 1, 1);
    const data = tempCtx.getImageData(0, 0, 1, 1).data;
    const finalA = (extractedAlpha !== null ? extractedAlpha : data[3] / 255) * alphaOverride;
    return `rgba(${data[0]}, ${data[1]}, ${data[2]}, ${finalA})`;
  } catch (e) {}

  return `rgba(255, 255, 255, ${alphaOverride})`;
}

function interpolateMultiStop(colorArray, t) {
  if (!colorArray || colorArray.length === 0) return 'rgba(255, 255, 255, 1)';
  if (colorArray.length === 1) return parseColorToRgba(colorArray[0]);

  const clampedT = Math.max(0, Math.min(1, t));
  const numSegments = colorArray.length - 1;
  const scaledT = clampedT * numSegments;
  const idx = Math.min(numSegments - 1, Math.floor(scaledT));
  const frac = scaledT - idx;

  const v1 = parseColorToVec3(colorArray[idx]);
  const v2 = parseColorToVec3(colorArray[idx + 1]);

  const r = Math.round((v1[0] + (v2[0] - v1[0]) * frac) * 255);
  const g = Math.round((v1[1] + (v2[1] - v1[1]) * frac) * 255);
  const b = Math.round((v1[2] + (v2[2] - v1[2]) * frac) * 255);

  return `rgba(${r}, ${g}, ${b}, 1)`;
}

function getHeaderTextColor() {
  const autoContrast = controls.get('useAutoContrast') === true;
  if (autoContrast) {
    return isBgDark() ? '#f8fafc' : '#0f172a';
  }
  const custom = controls.get('headerColor');
  if (custom) return parseColorToRgba(custom);
  return isBgDark() ? '#f8fafc' : '#0f172a';
}

function getSegmentTextColor(bubbleColor = null) {
  const autoContrast = controls.get('useAutoContrast') === true;
  if (autoContrast) {
    if (bubbleColor && !controls.get('heatmapView')) {
      const rgb = parseColorToVec3(bubbleColor, [1, 1, 1]);
      const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
      return lum > 0.45 ? '#0d0f12' : '#ffffff';
    }
    return isBgDark() ? '#f8fafc' : '#0f172a';
  }
  const custom = controls.get('textColor');
  if (custom) return parseColorToRgba(custom);
  if (bubbleColor && !controls.get('heatmapView')) {
    const rgb = parseColorToVec3(bubbleColor, [1, 1, 1]);
    const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    return lum > 0.45 ? '#0d0f12' : '#ffffff';
  }
  return isBgDark() ? '#f8fafc' : '#0f172a';
}

function getBgColor() {
  const c = controls.get('baseBgColor');
  if (c) return parseColorToRgba(c);
  return '#0a0a0f';
}

function isBgDark() {
  if (controls.get('enableGradient') === true) {
    let totalLum = 0;
    for (let i = 1; i <= 3; i++) {
      const rgb = hexToVec3(getGradientColor(i), [0.5, 0.5, 0.5]);
      totalLum += 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    }
    return (totalLum / 3.0) < 0.5;
  }
  const hex = getBgColor();
  const rgb = hexToVec3(hex, [1, 1, 1]);
  const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return lum < 0.5;
}

function renderThermalShader(timestamp, activeCount, modeInt) {
  if (!gl || !glProgram) return;

  const w = canvas.width;
  const h = canvas.height;
  if (w <= 0 || h <= 0) return;

  if (glCanvas.width !== w || glCanvas.height !== h) {
    glCanvas.width = w;
    glCanvas.height = h;
  }

  gl.viewport(0, 0, w, h);
  gl.useProgram(glProgram);

  gl.uniform2f(glUniforms.u_resolution, w, h);

  const chartX = typeof controls.get('chartX') === 'number' ? controls.get('chartX') : 0;
  const chartY = typeof controls.get('chartY') === 'number' ? controls.get('chartY') : 0;
  const offsetX = chartX * w * 0.5;
  const offsetY = -chartY * h * 0.5;
  gl.uniform2f(glUniforms.u_chartOffset, offsetX, offsetY);

  gl.uniform1f(glUniforms.u_time, timestamp * 0.001);
  gl.uniform1i(glUniforms.u_mode, modeInt);
  gl.uniform1i(glUniforms.u_activeCount, activeCount);

  const isHeatmapOn = controls.get('enableHeatmap') !== false;
  gl.uniform1i(glUniforms.u_enableHeatmap, isHeatmapOn ? 1 : 0);

  const isHeatmapViewOn = controls.get('heatmapView') === true;
  gl.uniform1i(glUniforms.u_heatmapView, isHeatmapViewOn ? 1 : 0);

  const waveLayers = typeof controls.get('waveLayers') === 'number' ? controls.get('waveLayers') : 36;
  const waveSpread = typeof controls.get('waveSpread') === 'number' ? controls.get('waveSpread') : 220;
  const waveFalloff = typeof controls.get('waveFalloff') === 'number' ? controls.get('waveFalloff') : 1.6;
  const animateWaves = controls.get('animateWaves') !== false;

  gl.uniform1f(glUniforms.u_waveLayers, waveLayers);
  gl.uniform1f(glUniforms.u_waveSpread, waveSpread);
  gl.uniform1f(glUniforms.u_waveFalloff, waveFalloff);
  gl.uniform1i(glUniforms.u_animateWaves, animateWaves ? 1 : 0);

  const isoPresetKey = controls.get('isolinePalette') || 'thermal';
  const isoPreset = ISOLINE_PALETTES[isoPresetKey] || ISOLINE_PALETTES.thermal;

  const isoC1 = controls.get('isoColor1') || isoPreset[0];
  const isoC2 = controls.get('isoColor2') || isoPreset[1];
  const isoC3 = controls.get('isoColor3') || isoPreset[2];
  const isoC4 = controls.get('isoColor4') || isoPreset[3];
  const isoC5 = controls.get('isoColor5') || isoPreset[4];

  gl.uniform3fv(glUniforms.u_isoColor0, hexToVec3(isoC1));
  gl.uniform3fv(glUniforms.u_isoColor1, hexToVec3(isoC2));
  gl.uniform3fv(glUniforms.u_isoColor2, hexToVec3(isoC3));
  gl.uniform3fv(glUniforms.u_isoColor3, hexToVec3(isoC4));
  gl.uniform3fv(glUniforms.u_isoColor4, hexToVec3(isoC5));

  const isGradOn = controls.get('enableGradient') === true;
  gl.uniform1i(glUniforms.u_enableGradient, isGradOn ? 1 : 0);

  const grad1Vec = hexToVec3(getGradientColor(1), [0.0, 0.0, 0.0]);
  const grad2Vec = hexToVec3(getGradientColor(2), [0.0, 1.0, 0.6]);
  const grad3Vec = hexToVec3(getGradientColor(3), [0.48, 0.22, 0.93]);
  const gradSpeed = typeof controls.get('gradientSpeed') === 'number' ? controls.get('gradientSpeed') : 6;

  gl.uniform3fv(glUniforms.u_gradientColor1, grad1Vec);
  gl.uniform3fv(glUniforms.u_gradientColor2, grad2Vec);
  gl.uniform3fv(glUniforms.u_gradientColor3, grad3Vec);
  gl.uniform1f(glUniforms.u_gradientSpeed, gradSpeed);

  const scale = state.chartScale;
  gl.uniform1f(glUniforms.u_chartScale, scale);

  const minDim = Math.min(w, h) * scale;
  const innerR = minDim * 0.16;
  const cutoutR = modeInt === 2 ? 0.0 : Math.max(10, innerR - 6.0 * scale);
  gl.uniform1f(glUniforms.u_centerCutoutR, cutoutR);

  const sminK = Math.max(16.0, Math.min(42.0, 26.0 * scale));
  gl.uniform1f(glUniforms.u_sminK, sminK);

  const softness = Math.max(0.1, typeof controls.get('segmentSoftness') === 'number' ? controls.get('segmentSoftness') : 1.0);
  gl.uniform1f(glUniforms.u_segmentSoftness, softness);

  // Decoupled Background and Segment Noise
  const rawBgNoise = typeof controls.get('bgNoiseAmount') === 'number' ? controls.get('bgNoiseAmount') : 0.10;
  const rawSegNoise = typeof controls.get('segmentNoise') === 'number' ? controls.get('segmentNoise') : 0.05;

  gl.uniform1f(glUniforms.u_bgNoise, rawBgNoise);
  gl.uniform1f(glUniforms.u_segmentNoise, rawSegNoise);

  function getThermalColor(key, defaultHex) {
    const c = controls.get(key);
    return c || defaultHex;
  }

  const bgHex = getBgColor();
  const bgVec = hexToVec3(bgHex, [0.04, 0.04, 0.06]);

  const presetKey = controls.get('colorPreset') || 'thermal';
  const fallbackP = THERMAL_PRESETS[presetKey] || THERMAL_PRESETS.thermal;

  const coreHex = getThermalColor('colorCore', fallbackP.core);
  const highHex = getThermalColor('colorHigh', fallbackP.high);
  const midHex = getThermalColor('colorMid', fallbackP.mid);
  const lowHex = getThermalColor('colorLow', fallbackP.low);
  const edgeHex = getThermalColor('colorEdge', fallbackP.edge);

  gl.uniform3fv(glUniforms.u_bgColor, bgVec);
  gl.uniform3fv(glUniforms.u_colorCore, hexToVec3(coreHex, [1.0, 1.0, 1.0]));
  gl.uniform3fv(glUniforms.u_colorHigh, hexToVec3(highHex, [1.0, 0.95, 0.25]));
  gl.uniform3fv(glUniforms.u_colorMid, hexToVec3(midHex, [0.0, 0.88, 1.0]));
  gl.uniform3fv(glUniforms.u_colorLow, hexToVec3(lowHex, [0.68, 0.42, 0.95]));
  gl.uniform3fv(glUniforms.u_colorEdge, hexToVec3(edgeHex, [1.0, 0.62, 0.42]));

  for (let i = 0; i < 15; i++) {
    const slot = state.slots[i];
    const hoverP = slot ? slot.hoverProgress : 0;
    const baseVal = slot ? slot.currentVal : 0;
    const val = baseVal + (100.0 - baseVal) * hoverP;
    const active = slot ? slot.currentActive : 0;

    const cx = slot ? slot.currentCx : 0;
    const cy = slot ? slot.currentCy : 0;

    const innerR_node = slot ? slot.currentInnerR : 0;
    const outerR_node = slot ? slot.currentOuterR : 0;
    const startA_node = slot ? slot.currentStartA : 0;
    const endA_node = slot ? slot.currentEndA : 0;
    const cornerR_node = slot ? slot.currentCornerR : 0;

    const slotColorHex = getSlotColor(i);
    const slotColorVec = hexToVec3(slotColorHex, [0.15, 0.65, 0.9]);

    gl.uniform2f(glUniforms[`u_nodePos[${i}]`], cx, cy);
    gl.uniform1f(glUniforms[`u_nodeVal[${i}]`], val);
    gl.uniform1f(glUniforms[`u_nodeOuterR[${i}]`], outerR_node);
    gl.uniform1f(glUniforms[`u_nodeInnerR[${i}]`], innerR_node);
    gl.uniform1f(glUniforms[`u_nodeStartA[${i}]`], startA_node);
    gl.uniform1f(glUniforms[`u_nodeEndA[${i}]`], endA_node);
    gl.uniform1f(glUniforms[`u_nodeCornerR[${i}]`], cornerR_node);
    gl.uniform1f(glUniforms[`u_nodeActive[${i}]`], active);
    gl.uniform3fv(glUniforms[`u_nodeColor[${i}]`], slotColorVec);
  }

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

const MAX_SLOTS = 15;

const THERMAL_PRESETS = {
  thermal: { core: '#FFFFFF', high: '#FFFFB3', mid: '#00E5FF', low: '#B088F9', edge: '#FFA472' },
  magma: { core: '#FCFDBF', high: '#FE9F6D', mid: '#DE4968', low: '#8C2981', edge: '#280B54' },
  ocean: { core: '#E0F7FA', high: '#80DEEA', mid: '#00ACC1', low: '#0D47A1', edge: '#030F26' },
  cyberpunk: { core: '#FFFFFF', high: '#00FFCC', mid: '#FF007F', low: '#7000FF', edge: '#1A0033' },
  emerald: { core: '#F0FDF4', high: '#86EFAC', mid: '#10B981', low: '#047857', edge: '#022C22' },
  sunset: { core: '#FFF7ED', high: '#FDE047', mid: '#F97316', low: '#991B1B', edge: '#450A0A' },
  neon: { core: '#FFFFFF', high: '#CCFF00', mid: '#FF0099', low: '#00E5FF', edge: '#3A0066' },
  mono: { core: '#FFFFFF', high: '#E5E7EB', mid: '#9CA3AF', low: '#4B5563', edge: '#1F2937' }
};

if (typeof controls !== 'undefined' && typeof controls.onChange === 'function') {
  controls.onChange('isolinePalette', (presetKey) => {
    const p = ISOLINE_PALETTES[presetKey];
    if (p && typeof controls.set === 'function') {
      controls.set('isoColor1', p[0]);
      controls.set('isoColor2', p[1]);
      controls.set('isoColor3', p[2]);
      controls.set('isoColor4', p[3]);
      controls.set('isoColor5', p[4]);
    }
  });

  controls.onChange('colorPreset', (presetKey) => {
    const p = THERMAL_PRESETS[presetKey];
    if (p && typeof controls.set === 'function') {
      controls.set('colorCore', p.core);
      controls.set('colorHigh', p.high);
      controls.set('colorMid', p.mid);
      controls.set('colorLow', p.low);
      controls.set('colorEdge', p.edge);
    }
  });
}

const DEFAULT_COLORS = [
  '#27AAE2', '#00A89C', '#2BB674', '#8DC73F', '#D6DF24',
  '#F8ED31', '#FBB13F', '#F7941D', '#F05A2C', '#EF4138',
  '#DA1C5C', '#EE2B7A', '#DA1C5C', '#DA1C1F', '#ED0306'
];

const DEFAULT_GRADIENT_COLORS = [
  '#000000', '#00ff9a', '#7c3aed'
];

// Dynamic Font Loading & W3C Canvas2D Font Construction
const loadedFontLinks = new Set();
const loadedFontFaceUrls = new Set();

function ensureFontLoaded(family, fontUrl = null) {
  if (!family) return;
  const clean = family.replace(/["']/g, '').trim();
  if (!clean) return;

  const lower = clean.toLowerCase();
  const genericFamilies = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', '-apple-system', 'blinkmacsystemfont', 'arial', 'arial narrow', 'helvetica', 'times new roman', 'courier new', 'trebuchet ms', 'verdana', 'georgia', 'impact', 'comic sans ms'];
  if (genericFamilies.includes(lower) && !fontUrl) {
    return;
  }

  if (fontUrl && typeof FontFace !== 'undefined' && !loadedFontFaceUrls.has(fontUrl)) {
    loadedFontFaceUrls.add(fontUrl);
    try {
      const fontFace = new FontFace(clean, `url("${fontUrl}")`);
      fontFace.load().then(loaded => {
        if (document.fonts) document.fonts.add(loaded);
      }).catch(() => {});
    } catch (e) {}
    return;
  }

  if (!loadedFontLinks.has(lower) && typeof fetch !== 'undefined' && typeof FontFace !== 'undefined') {
    loadedFontLinks.add(lower);
    const fontSlug = encodeURIComponent(clean).replace(/%20/g, '+');
    const cssUrl = `https://fonts.googleapis.com/css2?family=${fontSlug}:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,700&display=swap`;
    
    fetch(cssUrl)
      .then(res => res.text())
      .then(css => {
        const matches = Array.from(css.matchAll(/src:\s*url\((https:\/\/[^)]+)\)/g));
        matches.forEach(m => {
          const url = m[1];
          const fontFace = new FontFace(clean, `url(${url})`);
          fontFace.load().then(loaded => {
            if (document.fonts) document.fonts.add(loaded);
          }).catch(() => {});
        });
      })
      .catch(() => {});
  }
}

function getFontDetails() {
  let family = 'sans-serif';
  let weight = '400';
  let style = 'normal';
  let fontUrl = null;

  const fontVal = controls.get('fontFamily');
  if (fontVal && typeof fontVal === 'object') {
    if (fontVal.family) family = fontVal.family;
    if (fontVal.weight) weight = fontVal.weight;
    if (fontVal.style) style = fontVal.style;
    if (fontVal.url) fontUrl = fontVal.url;
  } else if (typeof fontVal === 'string' && fontVal.trim().length > 0) {
    family = fontVal.trim();
  }

  const cleanFamily = family.replace(/["']/g, '').trim();
  ensureFontLoaded(cleanFamily, fontUrl);

  const lower = cleanFamily.toLowerCase();
  const genericFamilies = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', '-apple-system', 'blinkmacsystemfont'];

  let familyCss = '';
  if (genericFamilies.includes(lower)) {
    familyCss = lower;
  } else {
    familyCss = `"${cleanFamily}", sans-serif`;
  }

  return {
    family: familyCss,
    rawFamily: cleanFamily,
    weight: String(weight || '400'),
    style: String(style || 'normal')
  };
}

function makeFontString(fontSizePx, customWeight = null, customStyle = null) {
  const details = getFontDetails();

  let styleStr = '';
  const chosenStyle = (customStyle || details.style || '').toLowerCase();
  if (chosenStyle === 'italic' || chosenStyle === 'oblique') {
    styleStr = chosenStyle;
  }

  let weightStr = '';
  if (customWeight) {
    weightStr = String(customWeight);
  } else if (details.weight && details.weight !== 'normal' && details.weight !== '400') {
    weightStr = String(details.weight);
  }

  const parts = [];
  if (styleStr) parts.push(styleStr);
  if (weightStr) parts.push(weightStr);
  parts.push(`${Math.round(fontSizePx)}px`);
  parts.push(details.family);

  return parts.join(' ');
}

// Animation & Interaction State
const state = {
  mode: 'petal',
  weights: {
    petal: 1,
    concentric: 0,
    bubble: 0,
  },
  chartScale: 1.0,
  targetChartScale: 1.0,
  activeCount: 8,
  slots: Array.from({ length: MAX_SLOTS }, () => ({
    currentVal: 0,
    targetVal: 0,
    currentActive: 0,
    targetActive: 0,
    hoverProgress: 0,
    currentCx: 0,
    targetCx: 0,
    currentCy: 0,
    targetCy: 0,
    currentInnerR: 0,
    targetInnerR: 0,
    currentOuterR: 0,
    targetOuterR: 0,
    currentStartA: -Math.PI / 2,
    targetStartA: -Math.PI / 2,
    currentEndA: -Math.PI / 2,
    targetEndA: -Math.PI / 2,
    currentCornerR: 0,
    targetCornerR: 0,
  })),
  bubbleTargets: Array.from({ length: MAX_SLOTS }, () => ({ x: 0, y: 0, r: 20 })),
  hoveredIndex: -1,
  mouse: { x: -999, y: -999, active: false },
  tooltip: { x: 0, y: 0, targetX: 0, targetY: 0, opacity: 0, targetOpacity: 0, index: -1 },
  lastTime: performance.now(),
  modeTransition: {
    active: false,
    startTime: 0,
    duration: 650,
    fromMode: 'petal',
    toMode: 'petal',
    progress: 1.0,
    easedT: 1.0,
  },
  isSequenceAnimating: false,
  seqStartTime: 0,
  center: {
    hoverAlpha: 0,
    displayedVal: 0,
    displayedLabel: '',
    displayedColor: '#ffffff',
    displayedPct: 0,
  },
};

let lastKnownMode = 'petal';

function computeBubblePacking(activeCount, scale, minDim) {
  const maxR = minDim * 0.43;
  const outerMargin = Math.max(2, Math.round(3 * scale));
  const availableR = Math.max(20, maxR - outerMargin);

  const activeVals = [];
  for (let i = 0; i < activeCount; i++) {
    activeVals.push(Math.max(1, state.slots[i].targetVal || 10));
  }

  const sumVal = activeVals.reduce((a, b) => a + b, 0) || 1;
  const targetFill = activeCount <= 4 ? 0.76 : activeCount <= 8 ? 0.83 : 0.88;
  const k = Math.sqrt((targetFill * availableR * availableR) / sumVal);

  const minBubbleR = Math.max(12 * scale, 14);
  const rawRadii = activeVals.map(v => Math.max(minBubbleR, k * Math.sqrt(v)));

  const indices = Array.from({ length: activeCount }, (_, i) => i);
  indices.sort((a, b) => rawRadii[b] - rawRadii[a]);

  const positions = Array.from({ length: activeCount }, () => ({ x: 0, y: 0 }));
  const radii = [...rawRadii];

  for (let rank = 0; rank < activeCount; rank++) {
    const idx = indices[rank];
    if (rank === 0) {
      positions[idx].x = 0;
      positions[idx].y = 0;
    } else {
      const angle = rank * 2.39996323;
      const dist = availableR * 0.46 * Math.sqrt(rank / activeCount);
      positions[idx].x = Math.cos(angle) * dist;
      positions[idx].y = Math.sin(angle) * dist;
    }
  }

  const overlapFactor = 0.952;
  const iterations = 480;

  for (let it = 0; it < iterations; it++) {
    const progress = it / iterations;
    const alpha = Math.max(0.04, Math.pow(1.0 - progress, 1.3));

    for (let i = 0; i < activeCount; i++) {
      const d = Math.hypot(positions[i].x, positions[i].y);
      if (d > 0.001) {
        const pull = 0.042 * alpha;
        positions[i].x -= positions[i].x * pull;
        positions[i].y -= positions[i].y * pull;
      }
    }

    for (let i = 0; i < activeCount; i++) {
      for (let j = i + 1; j < activeCount; j++) {
        let dx = positions[j].x - positions[i].x;
        let dy = positions[j].y - positions[i].y;
        let dist = Math.hypot(dx, dy);
        const contactDist = (radii[i] + radii[j]) * overlapFactor;

        if (dist < contactDist) {
          if (dist < 0.001) {
            const seedAngle = (i * 37 + j * 53) * 0.1;
            dx = Math.cos(seedAngle) * 0.1;
            dy = Math.sin(seedAngle) * 0.1;
            dist = 0.1;
          }

          const overlap = contactDist - dist;
          const nx = dx / dist;
          const ny = dy / dist;

          const totalR = radii[i] + radii[j];
          const w1 = radii[j] / totalR;
          const w2 = radii[i] / totalR;

          const pushAmount = overlap * (0.58 + 0.42 * alpha);
          positions[i].x -= nx * pushAmount * w1;
          positions[i].y -= ny * pushAmount * w1;
          positions[j].x += nx * pushAmount * w2;
          positions[j].y += ny * pushAmount * w2;
        }
      }
    }

    for (let i = 0; i < activeCount; i++) {
      const maxAllowedDist = availableR - radii[i] * 0.98;
      const d = Math.hypot(positions[i].x, positions[i].y);
      if (maxAllowedDist > 0 && d > maxAllowedDist) {
        positions[i].x = (positions[i].x / d) * maxAllowedDist;
        positions[i].y = (positions[i].y / d) * maxAllowedDist;
      }
    }
  }

  for (let i = 0; i < activeCount; i++) {
    state.bubbleTargets[i] = {
      x: positions[i].x,
      y: positions[i].y,
      r: radii[i],
    };
  }
}

function updateSlotTargets() {
  const w = canvas.width;
  const h = canvas.height;
  const scale = state.targetChartScale;
  const minDim = Math.min(w, h) * scale;
  const activeCount = state.activeCount;

  const innerR = minDim * 0.16;
  const maxR = minDim * 0.43;
  const userCornerR = getCornerRadius() * scale;

  const isHeatmapOn = controls.get('enableHeatmap') !== false;

  computeBubblePacking(activeCount, scale, minDim);

  for (let i = 0; i < MAX_SLOTS; i++) {
    const slot = state.slots[i];
    const val = Math.max(0, slot.currentVal);
    const targetV = Math.max(1, slot.targetVal);
    const growthRatio = Math.max(0, Math.min(1.0, val / targetV));

    // 1. Petal Geometry
    const baseStep = (Math.PI * 2) / activeCount;
    const midAngle = -Math.PI / 2 + (i + 0.5) * baseStep;

    let petalInnerR, petalOuterR, petalStartA, petalEndA, petalCornerR;

    if (isHeatmapOn) {
      const rawValRatio = Math.max(0.02, Math.min(1.0, val / 100));
      const contrastRatio = Math.pow(rawValRatio, 1.75);

      const minSpanFactor = 0.12;
      const maxSpanFactor = 1.48;
      const spanFactor = minSpanFactor + (maxSpanFactor - minSpanFactor) * contrastRatio;
      const petalAngleSpan = baseStep * spanFactor;

      petalStartA = midAngle - petalAngleSpan / 2;
      petalEndA = midAngle + petalAngleSpan / 2;

      petalInnerR = innerR + 18.0 * scale;
      const maxPetalR = minDim * 0.42;
      const fullRadialSpan = maxPetalR - petalInnerR;
      const minRadialRatio = 0.06;
      const radialRatio = minRadialRatio + (1.0 - minRadialRatio) * contrastRatio;
      petalOuterR = petalInnerR + fullRadialSpan * radialRatio;
      petalCornerR = Math.min(userCornerR, (petalOuterR - petalInnerR) * 0.48);
    } else {
      petalInnerR = innerR;
      const valRatio = Math.max(0.04, Math.min(1.0, val / 100));
      petalOuterR = innerR + (maxR - innerR) * valRatio;

      const gapAngle = Math.min(0.08, baseStep * 0.12);
      const petalAngleSpan = baseStep - gapAngle;

      petalStartA = midAngle - petalAngleSpan / 2;
      petalEndA = midAngle + petalAngleSpan / 2;
      petalCornerR = Math.min(userCornerR, (petalOuterR - petalInnerR) * 0.48);
    }

    // 2. Concentric Geometry
    const totalSpan = maxR - minDim * 0.16;
    const ringSpacing = totalSpan / Math.max(3, activeCount);
    const ringWidth = ringSpacing * 0.72;
    const concOuterR = maxR - i * ringSpacing;
    const concInnerR = concOuterR - ringWidth;
    const maxConcSweep = (Math.PI * 2 - 0.18) * 0.88;
    const valRatio = Math.max(0.01, Math.min(1.0, val / 100));
    const concSweep = maxConcSweep * valRatio;
    const concStartA = -Math.PI / 2;
    const concEndA = concStartA + concSweep;
    const concCornerR = Math.min(userCornerR, (concOuterR - concInnerR) * 0.48);

    // 3. Bubble Geometry
    const bTarget = state.bubbleTargets[i] || { x: 0, y: 0, r: 20 };
    const bubbleX = bTarget.x * (0.2 + 0.8 * growthRatio);
    const bubbleY = bTarget.y * (0.2 + 0.8 * growthRatio);
    const bubbleR = bTarget.r * growthRatio;
    const bubbleStartA = -Math.PI / 2;
    const bubbleEndA = -Math.PI / 2 + Math.PI * 2;
    const bubbleInnerR = 0;
    const bubbleOuterR = bubbleR;
    const bubbleCornerR = 0;

    const wp = state.weights.petal;
    const wc = state.weights.concentric;
    const wb = state.weights.bubble;

    slot.targetCx = wp * 0 + wc * 0 + wb * bubbleX;
    slot.targetCy = wp * 0 + wc * 0 + wb * bubbleY;
    slot.targetInnerR = wp * petalInnerR + wc * concInnerR + wb * bubbleInnerR;
    slot.targetOuterR = wp * petalOuterR + wc * concOuterR + wb * bubbleOuterR;
    slot.targetStartA = wp * petalStartA + wc * concStartA + wb * bubbleStartA;
    slot.targetEndA = wp * petalEndA + wc * concEndA + wb * bubbleEndA;
    slot.targetCornerR = wp * petalCornerR + wc * concCornerR + wb * bubbleCornerR;
  }
}

function syncTargetState() {
  const currentMode = controls.get('mode') || 'petal';

  if (currentMode !== lastKnownMode) {
    const animSpeed = controls.get('animSpeed') || 500;
    const duration = Math.max(480, Math.min(800, animSpeed * 1.15));

    state.modeTransition.active = true;
    state.modeTransition.startTime = performance.now();
    state.modeTransition.fromMode = lastKnownMode;
    state.modeTransition.toMode = currentMode;
    state.modeTransition.duration = duration;
    state.modeTransition.progress = 0;
    state.modeTransition.easedT = 0;

    lastKnownMode = currentMode;
  }

  state.mode = currentMode;

  const rawScale = controls.get('chartSize');
  state.targetChartScale = Math.max(0.5, Math.min(1.5, typeof rawScale === 'number' ? rawScale : 1.0));

  state.activeCount = Math.max(3, Math.min(MAX_SLOTS, Math.round(controls.get('activeSegments') || 8)));

  for (let i = 0; i < MAX_SLOTS; i++) {
    const valKey = `val${i + 1}`;
    const rawVal = controls.get(valKey);
    const numVal = Math.max(1, typeof rawVal === 'number' ? rawVal : 20);
    const isActive = i < state.activeCount;

    state.slots[i].targetVal = numVal;
    state.slots[i].targetActive = isActive ? 1 : 0;
  }

  updateSlotTargets();
}

syncTargetState();
for (let i = 0; i < MAX_SLOTS; i++) {
  state.slots[i].currentVal = state.slots[i].targetVal;
  state.slots[i].currentActive = state.slots[i].targetActive;
}
updateSlotTargets();
for (let i = 0; i < MAX_SLOTS; i++) {
  state.slots[i].currentCx = state.slots[i].targetCx;
  state.slots[i].currentCy = state.slots[i].targetCy;
  state.slots[i].currentInnerR = state.slots[i].targetInnerR;
  state.slots[i].currentOuterR = state.slots[i].targetOuterR;
  state.slots[i].currentStartA = state.slots[i].targetStartA;
  state.slots[i].currentEndA = state.slots[i].targetEndA;
  state.slots[i].currentCornerR = state.slots[i].targetCornerR;
}
state.weights.petal = state.mode === 'petal' ? 1 : 0;
state.weights.concentric = state.mode === 'concentric' ? 1 : 0;
state.weights.bubble = state.mode === 'bubble' ? 1 : 0;
state.chartScale = state.targetChartScale;

function triggerSequenceAnimation() {
  state.isSequenceAnimating = true;
  state.seqStartTime = performance.now();

  const minDim = Math.min(canvas.width, canvas.height) * state.chartScale;
  const innerR = minDim * 0.16;

  for (let i = 0; i < MAX_SLOTS; i++) {
    state.slots[i].currentVal = 0;
    state.slots[i].hoverProgress = 0;

    if (state.mode === 'petal') {
      state.slots[i].currentOuterR = innerR + 24.0 * state.chartScale;
      state.slots[i].currentInnerR = innerR + 24.0 * state.chartScale;
    } else if (state.mode === 'concentric') {
      state.slots[i].currentEndA = -Math.PI / 2;
    } else if (state.mode === 'bubble') {
      state.slots[i].currentOuterR = 0;
      state.slots[i].currentInnerR = 0;
      state.slots[i].currentCx = 0;
      state.slots[i].currentCy = 0;
    }
  }

  updateSlotTargets();
}

controls.onAction('startAnim', () => {
  triggerSequenceAnimation();
});

function getSlotColor(index) {
  const isMono = controls.get('monoMode') === true;
  if (isMono) {
    const monoC = controls.get('monoColor');
    return parseColorToRgba(monoC);
  }

  const activeCount = state.activeCount || 8;
  const stops = [
    controls.get('color1') || DEFAULT_COLORS[0],
    controls.get('color2') || DEFAULT_COLORS[1],
    controls.get('color3') || DEFAULT_COLORS[2],
    controls.get('color4') || DEFAULT_COLORS[3],
    controls.get('color5') || DEFAULT_COLORS[4],
  ];

  const customKey = `color${index + 1}`;
  const customVal = controls.get(customKey);
  if (index >= 5 && customVal && customVal !== DEFAULT_COLORS[index % DEFAULT_COLORS.length]) {
    return parseColorToRgba(customVal);
  }

  const t = activeCount > 1 ? index / (activeCount - 1) : 0;
  return interpolateMultiStop(stops, t);
}

function getGuideColor() {
  const val = controls.get('guideColor');
  if (val) return parseColorToRgba(val);
  return 'rgba(0, 0, 0, 0.20)';
}

function getSlotLabel(index) {
  const text = controls.get(`label${index + 1}`);
  return (typeof text === 'string' && text.trim().length > 0) ? text.trim() : `Metric ${index + 1}`;
}

function getCenterTitleLines() {
  const centerType = controls.get('centerContent') || 'text';
  if (centerType === 'numbers') {
    let currentSum = 0;
    for (let i = 0; i < state.activeCount; i++) {
      currentSum += state.slots[i].currentVal;
    }
    return [`${Math.round(currentSum)}`];
  }
  const text = controls.get('centerTitle');
  const str = (typeof text === 'string' && text.length > 0) ? text : 'Chart';
  return str.split('\n');
}

function getValNumberScale() {
  const raw = controls.get('valNumberSize');
  return typeof raw === 'number' ? Math.max(0.5, Math.min(2.0, raw)) : 1.0;
}

function getSegLabelScale() {
  const raw = controls.get('valNumberSize');
  return typeof raw === 'number' ? Math.max(0.5, Math.min(2.0, raw)) : 1.0;
}

function getCornerRadius() {
  const raw = controls.get('cornerRadius');
  return typeof raw === 'number' ? Math.max(0, Math.min(40, raw)) : 12;
}

function getGradientColor(index) {
  const key = `gradientColor${index}`;
  const defaultHex = DEFAULT_GRADIENT_COLORS[(index - 1) % DEFAULT_GRADIENT_COLORS.length];
  const c = controls.get(key);
  return c || defaultHex;
}

function getComputedLabelSizes(scale, activeCount = 8) {
  const valNumberScale = getValNumberScale();
  const segLabelScale = valNumberScale;
  const density = activeCount > 8 ? Math.max(0.72, 1 - (activeCount - 8) * 0.038) : 1.0;

  const valFontSize = Math.max(8, Math.round(16 * scale * valNumberScale * density));
  const lblFontSize = valFontSize;
  const vertItemGap = Math.max(1, Math.round(4 * scale * valNumberScale * density));
  const horizItemGap = Math.max(4, Math.round(8 * scale * valNumberScale * density));
  const groupHeight = valFontSize + lblFontSize + vertItemGap;
  const horizGroupHeight = valFontSize;
  return { valFontSize, lblFontSize, vertItemGap, horizItemGap, groupHeight, horizGroupHeight, valNumberScale, segLabelScale, density };
}

function baseMinR(minDim) {
  return minDim * 0.16;
}

function drawRoundedArcSectorPath(ctx, startA, endA, innerR, outerR, cornerR) {
  const sweep = Math.abs(endA - startA);
  const maxRC = Math.min((outerR - innerR) * 0.48, Math.max(0.1, innerR) * Math.sin(Math.min(Math.PI * 0.45, sweep * 0.5)) * 0.9);
  const rc = Math.max(0, Math.min(cornerR, maxRC));

  ctx.beginPath();

  if (rc < 0.5 || innerR < 1) {
    ctx.arc(0, 0, Math.max(1, outerR), startA, endA, false);
    if (innerR > 1) {
      ctx.lineTo(Math.cos(endA) * innerR, Math.sin(endA) * innerR);
      ctx.arc(0, 0, innerR, endA, startA, true);
    } else {
      ctx.lineTo(0, 0);
    }
    ctx.closePath();
    return;
  }

  const dA_out = Math.min(sweep * 0.42, rc / Math.max(1, outerR));
  const dA_in = Math.min(sweep * 0.42, rc / Math.max(1, innerR));

  const aOutStart = startA + dA_out;
  const aOutEnd = endA - dA_out;
  const aInEnd = endA - dA_in;
  const aInStart = startA + dA_in;

  ctx.arc(0, 0, outerR, aOutStart, aOutEnd, false);

  const pOuterEnd = { x: Math.cos(endA) * (outerR - rc), y: Math.sin(endA) * (outerR - rc) };
  const pInnerEnd = { x: Math.cos(endA) * (innerR + rc), y: Math.sin(endA) * (innerR + rc) };
  ctx.arcTo(Math.cos(endA) * outerR, Math.sin(endA) * outerR, pOuterEnd.x, pOuterEnd.y, rc);
  ctx.lineTo(pInnerEnd.x, pInnerEnd.y);

  ctx.arcTo(Math.cos(endA) * innerR, Math.sin(endA) * innerR, Math.cos(aInEnd) * innerR, Math.sin(aInEnd) * innerR, rc);

  ctx.arc(0, 0, innerR, aInEnd, aInStart, true);

  const pInnerStart = { x: Math.cos(startA) * (innerR + rc), y: Math.sin(startA) * (innerR + rc) };
  const pOuterStart = { x: Math.cos(startA) * (outerR - rc), y: Math.sin(startA) * (outerR - rc) };
  ctx.arcTo(Math.cos(startA) * innerR, Math.sin(startA) * innerR, pInnerStart.x, pInnerStart.y, rc);
  ctx.lineTo(pOuterStart.x, pOuterStart.y);

  ctx.arcTo(Math.cos(startA) * outerR, Math.sin(startA) * outerR, Math.cos(aOutStart) * outerR, Math.sin(aOutStart) * outerR, rc);

  ctx.closePath();
}

function getConcentricLayout(scale, activeCount) {
  const w = canvas.width;
  const h = canvas.height;
  const minDim = Math.min(w, h) * scale;
  const maxR = minDim * 0.43;
  const innerR = minDim * 0.16;

  const { valFontSize, lblFontSize } = getComputedLabelSizes(scale, activeCount);
  const fontH = Math.max(valFontSize, lblFontSize);
  const minStep = Math.max(18 * scale, fontH + 8 * scale);

  const N = Math.min(activeCount, MAX_SLOTS);
  const layout = [];

  const totalSpan = maxR - innerR;
  const ringSpacing = totalSpan / Math.max(3, activeCount);
  const ringWidth = ringSpacing * 0.72;

  const trackY = [];
  for (let i = 0; i < N; i++) {
    const slot = state.slots[i];
    const rOuter = slot ? slot.currentOuterR : (maxR - i * ringSpacing);
    const rInner = slot ? slot.currentInnerR : (rOuter - ringWidth);
    const rMid = (rOuter + rInner) * 0.5;
    trackY.push(-rMid);
  }

  const textY = new Array(N);
  const totalRequiredH = (N - 1) * minStep;
  const firstTrackY = trackY[0] || -maxR;
  const lastTrackY = trackY[N - 1] || -innerR;
  const midTrackY = (firstTrackY + lastTrackY) * 0.5;
  const trackSpan = Math.abs(lastTrackY - firstTrackY);

  if (totalRequiredH > trackSpan) {
    const startY = midTrackY - totalRequiredH * 0.5;
    for (let i = 0; i < N; i++) {
      textY[i] = startY + i * minStep;
    }
  } else {
    textY[0] = firstTrackY;
    for (let i = 1; i < N; i++) {
      textY[i] = Math.max(trackY[i], textY[i - 1] + minStep);
    }
    for (let i = N - 2; i >= 0; i--) {
      if (textY[i] > textY[i + 1] - minStep) {
        textY[i] = textY[i + 1] - minStep;
      }
    }
  }

  ctx.save();
  let maxValW = 0;
  for (let i = 0; i < N; i++) {
    const slot = state.slots[i];
    const valStr = `${Math.round(slot ? slot.currentVal : 0)}`;
    const hoverP = slot ? (slot.hoverProgress || 0) : 0;
    const hoverValScale = 1.0 + 0.18 * hoverP;
    const curValFontSize = Math.max(8, Math.round(valFontSize * hoverValScale));
    ctx.font = makeFontString(curValFontSize, 'bold');
    const mWidth = ctx.measureText(valStr).width;
    if (mWidth > maxValW) maxValW = mWidth;
  }
  ctx.restore();

  const xVal = -36 * scale;
  const xLbl = xVal - maxValW - 10 * scale;
  const xLineStart = xVal + 6 * scale;

  for (let i = 0; i < N; i++) {
    layout.push({
      textY: textY[i],
      trackY: trackY[i],
      xVal,
      xLbl,
      xLineStart,
      valFontSize,
      lblFontSize
    });
  }

  return layout;
}

function handlePointerMove(e) {
  const pos = CanvasRuntimeAPI.getMousePos(e);
  state.mouse.x = pos.x;
  state.mouse.y = pos.y;
  state.mouse.active = true;
}

function handlePointerLeave() {
  state.mouse.active = false;
  state.mouse.x = -999;
  state.mouse.y = -999;
  state.hoveredIndex = -1;
  state.tooltip.targetOpacity = 0;
}

canvas.addEventListener('pointermove', handlePointerMove);
canvas.addEventListener('pointerdown', handlePointerMove);
canvas.addEventListener('pointerleave', handlePointerLeave);

function hitTest(centerX, centerY, activeCount) {
  if (!state.mouse.active) return -1;
  const w = canvas.width;
  const h = canvas.height;
  const scale = state.chartScale;

  const dx = state.mouse.x - centerX;
  const dy = state.mouse.y - centerY;
  const dist = Math.hypot(dx, dy);

  const minDim = Math.min(w, h) * scale;
  const maxR = minDim * 0.43;
  const baseStep = (Math.PI * 2) / activeCount;
  const { groupHeight } = getComputedLabelSizes(scale, activeCount);
  const labelR = maxR + 18 * scale + groupHeight * 0.5;

  const wp = state.weights.petal;
  const wc = state.weights.concentric;
  const wb = state.weights.bubble;

  const concLayout = getConcentricLayout(scale, activeCount);

  // 1. Proximity check for interpolated label positions
  for (let i = 0; i < activeCount; i++) {
    const slot = state.slots[i];
    if (slot.currentActive < 0.01) continue;

    const aPetal = -Math.PI / 2 + (i + 0.5) * baseStep;
    const xPetal = Math.cos(aPetal) * labelR;
    const yPetal = Math.sin(aPetal) * labelR;

    const cItem = concLayout[i] || { xVal: -36 * scale, textY: -100 };
    const xConc = cItem.xVal;
    const yConc = cItem.textY;

    const xBubble = slot.currentCx;
    const yBubble = slot.currentCy;

    const lx = wp * xPetal + wc * xConc + wb * xBubble;
    const ly = wp * yPetal + wc * yConc + wb * yBubble;

    if (Math.hypot(dx - lx, dy - ly) <= Math.max(18 * scale, groupHeight * 0.85)) {
      return i;
    }
  }

  // 2. Shape hit testing according to active chart mode weights
  if (wb > 0.45) {
    for (let i = 0; i < activeCount; i++) {
      const slot = state.slots[i];
      if (slot.currentOuterR < 4) continue;
      const bx = slot.currentCx;
      const by = slot.currentCy;
      const br = slot.currentOuterR + 4 * scale;
      if (Math.hypot(dx - bx, dy - by) <= br) {
        return i;
      }
    }
    return -1;
  }

  if (wp >= wc) {
    const angle = Math.atan2(dy, dx);
    for (let i = 0; i < activeCount; i++) {
      const slot = state.slots[i];
      if (slot.currentActive < 0.05) continue;

      const midA = (slot.currentStartA + slot.currentEndA) * 0.5;
      const diffA = Math.atan2(Math.sin(angle - midA), Math.cos(angle - midA));
      const halfSpan = Math.abs(slot.currentEndA - slot.currentStartA) * 0.5;

      const outerR = slot.currentOuterR;
      const innerR_slot = slot.currentInnerR;

      if (Math.abs(diffA) <= halfSpan + 0.08 && dist >= innerR_slot - 10 * scale && dist <= outerR + 25 * scale) {
        return i;
      }
    }
  } else {
    let angle = Math.atan2(dy, dx) + Math.PI / 2;
    if (angle < 0) angle += Math.PI * 2;

    const totalSpan = maxR - baseMinR(minDim);
    const ringSpacing = totalSpan / Math.max(3, activeCount);
    const ringWidth = ringSpacing * 0.72;
    const maxSweepAngle = (Math.PI * 2 - 0.18) * 0.88;

    for (let i = 0; i < activeCount; i++) {
      const slot = state.slots[i];
      const rOuter = maxR - i * ringSpacing;
      const rInner = rOuter - ringWidth;
      const valRatio = Math.max(0.01, Math.min(1.0, slot.currentVal / 100));
      const sweepAngle = maxSweepAngle * valRatio;

      if (dist >= rInner - 6 * scale && dist <= rOuter + 6 * scale) {
        if (angle <= sweepAngle + 0.12) {
          return i;
        }
      }
    }
  }
  return -1;
}

let animationFrameId;

function render(timestamp) {
  const dt = Math.min(60, timestamp - state.lastTime);
  state.lastTime = timestamp;

  const animSpeedVal = controls.get('animSpeed') || 800;
  const lerpSpeed = Math.min(1, Math.max(0.01, (dt / Math.max(200, 1400 - animSpeedVal * 0.8)) * 3.8));

  if (state.modeTransition.active) {
    const elapsed = timestamp - state.modeTransition.startTime;
    const rawT = Math.min(1, Math.max(0, elapsed / state.modeTransition.duration));

    const easeT = rawT < 0.5
      ? 4 * rawT * rawT * rawT
      : 1 - Math.pow(-2 * rawT + 2, 3) / 2;

    state.modeTransition.progress = rawT;
    state.modeTransition.easedT = easeT;

    const fromM = state.modeTransition.fromMode;
    const toM = state.modeTransition.toMode;

    state.weights.petal = 0;
    state.weights.concentric = 0;
    state.weights.bubble = 0;

    if (state.weights[fromM] !== undefined) state.weights[fromM] = 1 - easeT;
    if (state.weights[toM] !== undefined) state.weights[toM] = easeT;

    if (rawT >= 1) {
      state.modeTransition.active = false;
      state.weights.petal = toM === 'petal' ? 1 : 0;
      state.weights.concentric = toM === 'concentric' ? 1 : 0;
      state.weights.bubble = toM === 'bubble' ? 1 : 0;
    }
  } else {
    state.weights.petal = state.mode === 'petal' ? 1 : 0;
    state.weights.concentric = state.mode === 'concentric' ? 1 : 0;
    state.weights.bubble = state.mode === 'bubble' ? 1 : 0;
  }

  state.chartScale += (state.targetChartScale - state.chartScale) * lerpSpeed;

  if (state.isSequenceAnimating) {
    const elapsed = timestamp - state.seqStartTime;
    const speedNorm = Math.max(0.15, Math.min(1.5, animSpeedVal / 900));
    const segDurationMs = Math.max(350, Math.round(650 / speedNorm));
    const staggerMs = Math.max(30, Math.round(75 / speedNorm));
    let allDone = true;

    for (let i = 0; i < MAX_SLOTS; i++) {
      const slot = state.slots[i];
      slot.currentActive += (slot.targetActive - slot.currentActive) * lerpSpeed;

      if (i < state.activeCount) {
        const segStartTime = i * staggerMs;
        const tLocal = (elapsed - segStartTime) / segDurationMs;
        if (tLocal < 1) allDone = false;

        const tClamped = Math.max(0, Math.min(1, tLocal));
        const ease = 1 - Math.pow(1 - tClamped, 3);
        slot.currentVal = ease * slot.targetVal;
      } else {
        slot.currentVal = 0;
      }

      const isHovered = (state.hoveredIndex === i);
      const targetHover = isHovered ? 1 : 0;
      slot.hoverProgress += (targetHover - slot.hoverProgress) * Math.min(1, dt * 0.015);
    }

    updateSlotTargets();

    for (let i = 0; i < MAX_SLOTS; i++) {
      const slot = state.slots[i];
      if (state.modeTransition.active) {
        slot.currentCx += (slot.targetCx - slot.currentCx) * lerpSpeed;
        slot.currentCy += (slot.targetCy - slot.currentCy) * lerpSpeed;
        slot.currentInnerR += (slot.targetInnerR - slot.currentInnerR) * lerpSpeed;
        slot.currentOuterR += (slot.targetOuterR - slot.currentOuterR) * lerpSpeed;
        slot.currentStartA += (slot.targetStartA - slot.currentStartA) * lerpSpeed;
        slot.currentEndA += (slot.targetEndA - slot.currentEndA) * lerpSpeed;
        slot.currentCornerR += (slot.targetCornerR - slot.currentCornerR) * lerpSpeed;
      } else {
        slot.currentCx = slot.targetCx;
        slot.currentCy = slot.targetCy;
        slot.currentInnerR = slot.targetInnerR;
        slot.currentOuterR = slot.targetOuterR;
        slot.currentStartA = slot.targetStartA;
        slot.currentEndA = slot.targetEndA;
        slot.currentCornerR = slot.targetCornerR;
      }
    }

    const totalDuration = (state.activeCount - 1) * staggerMs + segDurationMs;
    if (allDone && elapsed >= totalDuration) {
      state.isSequenceAnimating = false;
      for (let i = 0; i < state.activeCount; i++) {
        state.slots[i].currentVal = state.slots[i].targetVal;
      }
      updateSlotTargets();
    }
  } else {
    for (let i = 0; i < MAX_SLOTS; i++) {
      const slot = state.slots[i];
      slot.currentVal += (slot.targetVal - slot.currentVal) * lerpSpeed;
      slot.currentActive += (slot.targetActive - slot.currentActive) * lerpSpeed;

      const isHovered = (state.hoveredIndex === i);
      const targetHover = isHovered ? 1 : 0;
      slot.hoverProgress += (targetHover - slot.hoverProgress) * Math.min(1, dt * 0.015);
    }

    updateSlotTargets();

    for (let i = 0; i < MAX_SLOTS; i++) {
      const slot = state.slots[i];
      slot.currentCx += (slot.targetCx - slot.currentCx) * lerpSpeed;
      slot.currentCy += (slot.targetCy - slot.currentCy) * lerpSpeed;
      slot.currentInnerR += (slot.targetInnerR - slot.currentInnerR) * lerpSpeed;
      slot.currentOuterR += (slot.targetOuterR - slot.currentOuterR) * lerpSpeed;
      slot.currentStartA += (slot.targetStartA - slot.currentStartA) * lerpSpeed;
      slot.currentEndA += (slot.targetEndA - slot.currentEndA) * lerpSpeed;
      slot.currentCornerR += (slot.targetCornerR - slot.currentCornerR) * lerpSpeed;
    }
  }

  const isSegmentHovered = state.hoveredIndex >= 0 && state.hoveredIndex < state.activeCount;
  const targetHoverAlpha = isSegmentHovered ? 1 : 0;
  const fadeRate = Math.min(1, dt / 180);
  state.center.hoverAlpha += (targetHoverAlpha - state.center.hoverAlpha) * fadeRate;

  if (isSegmentHovered) {
    const idx = state.hoveredIndex;
    const targetV = state.slots[idx].currentVal;
    state.center.displayedVal += (targetV - state.center.displayedVal) * Math.min(1, dt / 80);
    state.center.displayedLabel = getSlotLabel(idx);
    state.center.displayedColor = getSlotColor(idx);

    const activeTargetVals = state.slots.slice(0, state.activeCount).map(s => s.targetVal);
    const sumVal = activeTargetVals.reduce((a, b) => a + b, 0) || 1;
    state.center.displayedPct = Math.round((state.slots[idx].targetVal / sumVal) * 100);
  }

  drawChart(timestamp);

  animationFrameId = requestAnimationFrame(render);
}

function drawFlatChartShapes(minDim, activeCount, scale) {
  const isBubble = state.weights.bubble > 0.5;
  const blendMode = controls.get('segmentBlendMode') || 'source-over';

  ctx.save();
  ctx.globalCompositeOperation = blendMode;

  for (let i = 0; i < activeCount; i++) {
    const slot = state.slots[i];
    if (slot.currentActive < 0.01) continue;

    const isHovered = (state.hoveredIndex === i);
    const hoverP = slot.hoverProgress;
    const color = getSlotColor(i);

    ctx.save();

    if (isBubble) {
      const cx = slot.currentCx;
      const cy = slot.currentCy;
      const r = slot.currentOuterR * (1 + 0.08 * hoverP);
      if (r < 2) { ctx.restore(); continue; }

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

    } else {
      const cx = slot.currentCx;
      const cy = slot.currentCy;
      const startA = slot.currentStartA;
      const endA = slot.currentEndA;
      const innerR = slot.currentInnerR;
      const outerR = slot.currentOuterR + (isHovered ? hoverP * 10 * scale : 0);
      const cornerR = slot.currentCornerR;

      if (outerR <= innerR + 1) { ctx.restore(); continue; }

      ctx.translate(cx, cy);

      drawRoundedArcSectorPath(ctx, startA, endA, innerR, outerR, cornerR);
      ctx.fillStyle = color;
      ctx.fill();
    }

    ctx.restore();
  }

  ctx.restore();
}

let bgImgObj = null;
let bgImgSrc = '';

let noiseCanvas = null;

function getNoiseCanvas() {
  if (!noiseCanvas) {
    const size = 256;
    noiseCanvas = document.createElement('canvas');
    noiseCanvas.width = size;
    noiseCanvas.height = size;
    const nCtx = noiseCanvas.getContext('2d');
    const imgData = nCtx.createImageData(size, size);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const v = Math.floor(Math.random() * 255);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = Math.floor(Math.random() * 190 + 30);
    }
    nCtx.putImageData(imgData, 0, 0);
  }
  return noiseCanvas;
}

function drawBackgroundNoise(w, h) {
  const bgNoise = typeof controls.get('bgNoiseAmount') === 'number' ? controls.get('bgNoiseAmount') : 0.10;
  if (bgNoise <= 0.001) return;

  const nCanvas = getNoiseCanvas();
  ctx.save();
  ctx.globalAlpha = Math.min(1.0, bgNoise * 0.4);
  ctx.globalCompositeOperation = 'source-over';

  try {
    const pattern = ctx.createPattern(nCanvas, 'repeat');
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, w, h);
    }
  } catch (e) {}

  ctx.restore();
}

function updateBgImage(src) {
  if (!src) {
    bgImgObj = null;
    bgImgSrc = '';
    return;
  }
  let cleanSrc = '';
  if (typeof src === 'string') {
    cleanSrc = src.trim();
  } else if (typeof src === 'object' && src !== null) {
    cleanSrc = src.url || src.value || src.src || src.data || '';
  }
  if (!cleanSrc) {
    bgImgObj = null;
    bgImgSrc = '';
    return;
  }
  if (cleanSrc === bgImgSrc) return;
  bgImgSrc = cleanSrc;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    bgImgObj = img;
  };
  img.onerror = () => {
    bgImgObj = null;
  };
  img.src = cleanSrc;
}

function drawLoopingBackgroundGradient(w, h, timestamp) {
  const speed = typeof controls.get('gradientSpeed') === 'number' ? controls.get('gradientSpeed') : 6;
  const phase = timestamp * 0.00035 * (speed / 6.0);
  const angle = phase * 0.6;

  const c1 = getGradientColor(1);
  const c2 = getGradientColor(2);
  const c3 = getGradientColor(3);
  const baseBg = getBgColor();

  ctx.fillStyle = baseBg;
  ctx.fillRect(0, 0, w, h);

  const diag = Math.hypot(w, h) * 0.58;
  const cx = w * 0.5;
  const cy = h * 0.5;

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';

  // Step 2 Linear Gradient
  const x0 = cx - Math.cos(angle) * diag;
  const y0 = cy - Math.sin(angle) * diag;
  const x1 = cx + Math.cos(angle) * diag;
  const y1 = cy + Math.sin(angle) * diag;

  const gw = ctx.createLinearGradient(x0, y0, x1, y1);
  const cols = [c1, c2, c3];
  const numStops = 8;
  for (let s = 0; s < numStops; s++) {
    const stopPos = s / (numStops - 1);
    const colorIdx = Math.floor((stopPos * 3 + phase) % 3);
    gw.addColorStop(stopPos, parseColorToRgba(cols[colorIdx], 0.85));
  }
  ctx.fillStyle = gw;
  ctx.fillRect(0, 0, w, h);

  // Step 3 Radial Auras
  const maxDim = Math.max(w, h);

  // Aura 1
  const a1x = cx + Math.cos(phase * 1.35) * w * 0.28;
  const a1y = cy + Math.sin(phase * 1.1) * h * 0.25;
  const a1r = maxDim * 0.72;
  const g1 = ctx.createRadialGradient(a1x, a1y, 0, a1x, a1y, a1r);
  g1.addColorStop(0, parseColorToRgba(c2, 0.55));
  g1.addColorStop(1, parseColorToRgba(c2, 0.0));
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, w, h);

  // Aura 2
  const a2x = cx + Math.sin(phase * 0.95 + 1.8) * w * 0.26;
  const a2y = cy + Math.cos(phase * 1.25 + 0.9) * h * 0.23;
  const a2r = maxDim * 0.65;
  const g2 = ctx.createRadialGradient(a2x, a2y, 0, a2x, a2y, a2r);
  g2.addColorStop(0, parseColorToRgba(c3, 0.45));
  g2.addColorStop(1, parseColorToRgba(c3, 0.0));
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, w, h);

  // Step 4 Vignette
  const gVig = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxDim * 0.70);
  gVig.addColorStop(0, 'rgba(0, 0, 0, 0.05)');
  gVig.addColorStop(1, 'rgba(0, 0, 0, 0.50)');
  ctx.fillStyle = gVig;
  ctx.fillRect(0, 0, w, h);

  ctx.restore();
}

function drawChart(timestamp = performance.now()) {
  const w = canvas.width;
  const h = canvas.height;

  const chartX = typeof controls.get('chartX') === 'number' ? controls.get('chartX') : 0;
  const chartY = typeof controls.get('chartY') === 'number' ? controls.get('chartY') : 0;
  const offsetX = chartX * w * 0.5;
  const offsetY = -chartY * h * 0.5;

  const centerX = w / 2 + offsetX;
  const centerY = h / 2 + offsetY;

  const scale = state.chartScale;
  const minDim = Math.min(w, h) * scale;

  ctx.clearRect(0, 0, w, h);

  const isHeatmapOn = controls.get('enableHeatmap') !== false;
  const isHeatmapViewOn = controls.get('heatmapView') === true;

  // Background base
  if (controls.get('enableGradient') === true) {
    drawLoopingBackgroundGradient(w, h, timestamp);
  } else {
    ctx.fillStyle = getBgColor();
    ctx.fillRect(0, 0, w, h);
  }

  // Background Image underlay
  const bgImageVal = controls.get('bgImage');
  updateBgImage(bgImageVal);

  const bgOpacity = typeof controls.get('bgOpacity') === 'number' ? controls.get('bgOpacity') : 0.8;
  const bgFit = controls.get('bgFit') || 'cover';

  if (bgImgObj && bgOpacity > 0.001) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, bgOpacity));
    if (bgFit === 'tile') {
      try {
        const pattern = ctx.createPattern(bgImgObj, 'repeat');
        if (pattern) {
          ctx.fillStyle = pattern;
          ctx.fillRect(0, 0, w, h);
        } else {
          CanvasRuntimeAPI.drawImage(ctx, bgImgObj, 0, 0, w, h, 'cover');
        }
      } catch (e) {
        CanvasRuntimeAPI.drawImage(ctx, bgImgObj, 0, 0, w, h, 'cover');
      }
    } else {
      CanvasRuntimeAPI.drawImage(ctx, bgImgObj, 0, 0, w, h, bgFit);
    }
    ctx.restore();
  }

  // Background procedural noise texture overlay
  drawBackgroundNoise(w, h);

  const activeCount = state.activeCount;
  const modeInt = state.weights.bubble > 0.5 ? 2 : state.weights.concentric > 0.5 ? 1 : 0;
  const activeTargetValues = state.slots.slice(0, activeCount).map(s => s.targetVal);
  const sumVal = activeTargetValues.reduce((a, b) => a + b, 0) || 1;

  if (isHeatmapOn || isHeatmapViewOn) {
    renderThermalShader(timestamp, activeCount, modeInt);

    if (glCanvas) {
      ctx.save();
      const blendMode = controls.get('segmentBlendMode') || 'source-over';
      ctx.globalCompositeOperation = blendMode;
      ctx.drawImage(glCanvas, 0, 0);
      ctx.restore();
    }
  }

  state.hoveredIndex = hitTest(centerX, centerY, activeCount);

  ctx.save();
  ctx.translate(centerX, centerY);

  // Draw Structural Guide Lines over background and WebGL heatmap layers so they remain visible in Heatmap Mode
  drawGuides(minDim, activeCount, sumVal, scale);

  if (!isHeatmapOn && !isHeatmapViewOn) {
    drawFlatChartShapes(minDim, activeCount, scale);
  }

  // Segment Labels & Value Numbers
  drawSegmentLabels(minDim, activeCount, sumVal, scale);

  ctx.restore();
}

function drawGuides(minDim, activeCount, sumVal, scale) {
  const isGuidesEnabled = controls.get('enableGuides') !== false;
  if (!isGuidesEnabled) return;

  const maxR = minDim * 0.43;
  const innerR = minDim * 0.16;

  const rawColor = getGuideColor();
  const rawOpacity = typeof controls.get('guideOpacity') === 'number' ? controls.get('guideOpacity') / 100 : 0.6;
  const guideColorStyle = parseColorToRgba(rawColor, rawOpacity);
  const lineWidthVal = typeof controls.get('guideWidth') === 'number' ? controls.get('guideWidth') : 1.2;

  ctx.save();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.strokeStyle = guideColorStyle;
  ctx.lineWidth = Math.max(0.5, lineWidthVal * scale);

  // Dotted Concentric Circles
  ctx.setLineDash([4 * scale, 4 * scale]);

  ctx.beginPath();
  ctx.arc(0, 0, innerR, 0, Math.PI * 2);
  ctx.stroke();

  if (state.weights.concentric > 0.5) {
    for (let i = 0; i < activeCount; i++) {
      const slot = state.slots[i];
      if (slot.currentActive < 0.01) continue;
      const rConc = (slot.currentInnerR + slot.currentOuterR) * 0.5;
      ctx.beginPath();
      ctx.arc(0, 0, rConc, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    for (let p = 0.33; p <= 0.67; p += 0.33) {
      const r = innerR + (maxR - innerR) * p;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(0, 0, maxR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.setLineDash([2 * scale, 3 * scale]);
  const anglePerSec = (Math.PI * 2) / activeCount;
  for (let i = 0; i < activeCount; i++) {
    const a = -Math.PI / 2 + i * anglePerSec;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * (innerR - 2 * scale), Math.sin(a) * (innerR - 2 * scale));
    ctx.lineTo(Math.cos(a) * (maxR + 12 * scale), Math.sin(a) * (maxR + 12 * scale));
    ctx.stroke();
  }

  ctx.restore();
}

function drawSegmentLabels(minDim, activeCount, sumVal, scale) {
  const maxR = minDim * 0.43;
  const dark = isBgDark();
  const baseStep = (Math.PI * 2) / activeCount;
  const { valFontSize, lblFontSize, vertItemGap, groupHeight } = getComputedLabelSizes(scale, activeCount);

  ctx.save();

  drawCenterDisplay(scale, sumVal);

  const wp = state.weights.petal;
  const wc = state.weights.concentric;
  const wb = state.weights.bubble;

  const concLayout = getConcentricLayout(scale, activeCount);

  for (let i = 0; i < activeCount; i++) {
    const slot = state.slots[i];
    if (slot.currentActive < 0.01) continue;

    const secVal = Math.round(slot.currentVal);
    const secLabel = getSlotLabel(i);
    const color = getSlotColor(i);
    const isHovered = (state.hoveredIndex === i);
    const hoverP = slot ? (slot.hoverProgress || 0) : 0;

    // 1. Petal Mode Position: anchored at outer guide line boundary circle
    const aPetal = -Math.PI / 2 + (i + 0.5) * baseStep;
    const labelR = maxR + 18 * scale + groupHeight * 0.5;
    const xPetal = Math.cos(aPetal) * labelR;
    const yPetal = Math.sin(aPetal) * labelR;

    // 2. Concentric Mode Position
    const cItem = concLayout[i] || { xVal: -36 * scale, xLbl: -80 * scale, xLineStart: -30 * scale, textY: -100, trackY: -100 };
    const xConc = cItem.xVal;
    const yConc = cItem.textY;

    // 3. Bubble Mode Position: directly inside the bubble center
    const xBubble = slot.currentCx;
    const yBubble = slot.currentCy;

    // Interpolated label center position across modes
    const lx = wp * xPetal + wc * xConc + wb * xBubble;
    const ly = wp * yPetal + wc * yConc + wb * yBubble;

    let curValFontSize = valFontSize;
    let curLblFontSize = lblFontSize;

    if (wc > 0.5) {
      const hoverValScale = 1.0 + 0.18 * hoverP;
      curValFontSize = Math.max(8, Math.round(valFontSize * hoverValScale));
      curLblFontSize = curValFontSize;

      const valStr = `${secVal}`;
      const lblStr = `${secLabel}`;
      const segTextColor = getSegmentTextColor();

      ctx.save();

      if (isHovered) {
        ctx.shadowColor = dark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(255, 255, 255, 0.9)';
        ctx.shadowBlur = 8 * scale;
      } else {
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }

      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = makeFontString(curValFontSize, 'bold');
      ctx.fillStyle = segTextColor;
      ctx.fillText(valStr, cItem.xVal, ly);

      ctx.font = makeFontString(curValFontSize, 'bold');
      ctx.fillStyle = segTextColor;
      ctx.fillText(lblStr, cItem.xLbl, ly);

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      const guideLineColor = isHovered
        ? (color === '#ffffff' || color === '#FFFFFF' ? (dark ? '#ffffff' : '#0f172a') : color)
        : (dark ? 'rgba(255, 255, 255, 0.42)' : 'rgba(15, 23, 42, 0.38)');

      ctx.strokeStyle = guideLineColor;
      ctx.lineWidth = (isHovered ? 2.2 : 1.2) * scale;

      const cpX = cItem.xLineStart + (0 - cItem.xLineStart) * 0.5;

      ctx.beginPath();
      ctx.moveTo(cItem.xLineStart, ly);
      ctx.bezierCurveTo(cpX, ly, cpX, cItem.trackY, 0, cItem.trackY);
      ctx.stroke();

      ctx.fillStyle = guideLineColor;
      ctx.beginPath();
      ctx.arc(0, cItem.trackY, (isHovered ? 3.5 : 2.5) * scale, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

    } else if (wb > 0.5) {
      const bubbleR = slot.currentOuterR;
      const fontFitScale = Math.min(1.0, Math.max(0.55, (bubbleR * 1.5) / (valFontSize + lblFontSize + vertItemGap)));
      const hoverValScale = 1.0 + 0.28 * hoverP;
      curValFontSize = Math.max(8, Math.round(valFontSize * fontFitScale * hoverValScale));
      curLblFontSize = curValFontSize;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const valY = ly - (curLblFontSize + vertItemGap) / 2;
      const lblY = ly + (curValFontSize + vertItemGap) / 2;

      const slotColor = getSlotColor(i);
      const textColor = getSegmentTextColor(slotColor);

      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;

      ctx.font = makeFontString(curValFontSize, 'bold');
      ctx.fillStyle = textColor;
      ctx.fillText(`${secVal}`, lx, valY);

      ctx.font = makeFontString(curValFontSize, 'bold');
      ctx.fillStyle = textColor;
      ctx.fillText(secLabel, lx, lblY);

      ctx.restore();

    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const hoverValScale = 1.0 + 0.18 * hoverP;
      curValFontSize = Math.max(8, Math.round(valFontSize * hoverValScale));
      curLblFontSize = curValFontSize;

      const valY = ly - (curLblFontSize + vertItemGap) / 2;
      const lblY = ly + (curValFontSize + vertItemGap) / 2;
      const segTextColor = getSegmentTextColor();

      if (isHovered) {
        ctx.shadowColor = dark ? 'rgba(0, 0, 0, 0.7)' : 'rgba(255, 255, 255, 0.9)';
        ctx.shadowBlur = 8 * scale;
      } else {
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }

      ctx.font = makeFontString(curValFontSize, 'bold');
      ctx.fillStyle = segTextColor;
      ctx.fillText(`${secVal}`, lx, valY);

      ctx.font = makeFontString(curValFontSize, 'bold');
      ctx.fillStyle = segTextColor;
      ctx.fillText(secLabel, lx, lblY);
    }
  }

  ctx.restore();
}

function drawCenterDisplay(scale, sumVal) {
  const wb = state.weights.bubble;
  if (wb > 0.01 || state.mode === 'bubble') return;

  const lines = getCenterTitleLines();
  const rawTitleSize = controls.get('centerTitleSize');
  const titleSizePx = typeof rawTitleSize === 'number' ? rawTitleSize : 24;
  const titleFontSize = Math.max(8, Math.round(titleSizePx * scale));
  const alpha = state.center.hoverAlpha;
  const headerColor = getHeaderTextColor();

  ctx.save();
  ctx.globalAlpha *= (1 - wb);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (alpha < 0.99) {
    ctx.save();
    ctx.globalAlpha = (1 - alpha);

    ctx.font = makeFontString(titleFontSize, 'bold');
    ctx.fillStyle = headerColor;

    const lineHeight = Math.round(titleFontSize * 1.25);
    const numLines = lines.length;
    const startY = -((numLines - 1) * lineHeight) / 2;

    for (let i = 0; i < numLines; i++) {
      const lineY = startY + i * lineHeight;
      ctx.fillText(lines[i], 0, lineY);
    }

    ctx.restore();
  }

  if (alpha > 0.01) {
    ctx.save();
    ctx.globalAlpha = alpha;

    const val = Math.round(state.center.displayedVal);

    ctx.font = makeFontString(titleFontSize, 'bold');
    ctx.fillStyle = headerColor;
    ctx.fillText(`${val}`, 0, 0);

    ctx.restore();
  }

  ctx.restore();
}

controls.onAny(() => {
  syncTargetState();
});

if (animationFrameId) cancelAnimationFrame(animationFrameId);
state.lastTime = performance.now();
render(performance.now());

    }