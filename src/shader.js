// Renders <video> frames through a WebGL shader onto a <canvas> placed on
// top of it. Currently a straight passthrough (fragment shader just samples
// the video texture) - this is the hook point for future per-frame effects.

const VERTEX_SHADER = `
attribute vec2 a_position;
uniform vec2 u_scale;
uniform float u_leftEdgeMargin;
uniform float u_rightEdgeMargin;
varying vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position * u_scale, 0.0, 1.0);
  // Sample only the true content region of the source frame, skipping the
  // baked-in fake pillarbox margins - this is what lets the real picture
  // fill more of the canvas instead of wasting space on dead bars.
  float u = (a_position.x + 1.0) / 2.0;
  v_texCoord = vec2(mix(u_leftEdgeMargin, 1.0 - u_rightEdgeMargin, u), (a_position.y + 1.0) / 2.0);
}
`

const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D u_texture;
uniform float u_scanlineIntensity;
varying vec2 v_texCoord;

void main() {
  vec4 color = texture2D(u_texture, v_texCoord);

  float scanline = sin(gl_FragCoord.y * 3.14159265) * u_scanlineIntensity;
  color.rgb -= scanline;

  gl_FragColor = color;
}
`

const LEFT_EDGE_MARGIN = 0.122
const RIGHT_EDGE_MARGIN = 0.126
const SCANLINE_INTENSITY = 0.05

function compileShader(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Shader compile failed: ${info}`)
  }
  return shader
}

function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram()
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertexSource))
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`Program link failed: ${info}`)
  }
  return program
}

// Sets up a canvas over `video` (inside `container`) that mirrors it via
// WebGL. Falls back to leaving the plain <video> visible if WebGL is
// unavailable.
export function setupShaderCanvas(video, container) {
  const canvas = document.createElement('canvas')
  canvas.id = 'shader-canvas'
  // Insert right after the video, not at the end of the container - other
  // overlays (e.g. the unmute hint) come after it in the DOM and need to
  // stay on top in paint order.
  video.insertAdjacentElement('afterend', canvas)

  const gl = canvas.getContext('webgl', { alpha: false }) || canvas.getContext('experimental-webgl', { alpha: false })
  if (!gl) {
    console.warn('WebGL unavailable - falling back to plain video playback')
    canvas.remove()
    return
  }

  const program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER)
  gl.useProgram(program)

  const positionBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

  const positionLoc = gl.getAttribLocation(program, 'a_position')
  gl.enableVertexAttribArray(positionLoc)
  gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0)

  const scaleLoc = gl.getUniformLocation(program, 'u_scale')
  const textureLoc = gl.getUniformLocation(program, 'u_texture')
  const leftEdgeMarginLoc = gl.getUniformLocation(program, 'u_leftEdgeMargin')
  const rightEdgeMarginLoc = gl.getUniformLocation(program, 'u_rightEdgeMargin')
  const scanlineIntensityLoc = gl.getUniformLocation(program, 'u_scanlineIntensity')

  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)

  gl.clearColor(0, 0, 0, 1)
  gl.uniform1i(textureLoc, 0)
  gl.uniform1f(leftEdgeMarginLoc, LEFT_EDGE_MARGIN)
  gl.uniform1f(rightEdgeMarginLoc, RIGHT_EDGE_MARGIN)
  gl.uniform1f(scanlineIntensityLoc, SCANLINE_INTENSITY)

  function resize() {
    const dpr = window.devicePixelRatio || 1
    const width = Math.round(container.clientWidth * dpr)
    const height = Math.round(container.clientHeight * dpr)
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    gl.viewport(0, 0, canvas.width, canvas.height)
    updateScale()
  }

  // Replicates object-fit: contain - scales the quad so the whole true
  // content frame (excluding the fake pillarbox margins cropped out above)
  // is visible, letterboxed/pillarboxed as needed.
  function updateScale() {
    const videoWidth = video.videoWidth
    const videoHeight = video.videoHeight
    if (!videoWidth || !videoHeight || !canvas.width || !canvas.height) return

    const contentWidth = videoWidth * (1 - LEFT_EDGE_MARGIN - RIGHT_EDGE_MARGIN)
    const canvasAspect = canvas.width / canvas.height
    const videoAspect = contentWidth / videoHeight
    const scaleX = videoAspect > canvasAspect ? 1 : videoAspect / canvasAspect
    const scaleY = videoAspect > canvasAspect ? canvasAspect / videoAspect : 1

    gl.useProgram(program)
    gl.uniform2f(scaleLoc, scaleX, scaleY)
  }

  video.addEventListener('loadedmetadata', resize)
  // ResizeObserver (rather than window's `resize` event) ties the canvas's
  // internal resolution directly to the container's actual box size, so it
  // can't fall out of sync during the transient viewport thrashing mobile
  // browsers do mid-rotation (toolbar show/hide, delayed `resize` firing).
  new ResizeObserver(resize).observe(container)
  resize()

  function draw() {
    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)

      gl.useProgram(program)
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
      gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    requestAnimationFrame(draw)
  }
  requestAnimationFrame(draw)
}
