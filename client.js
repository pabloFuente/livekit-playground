// PUB_TOKEN and SUB_TOKEN are injected by the server via /tokens.js
/* global LivekitClient, PUB_TOKEN, SUB_TOKEN */

const LIVEKIT_URL = 'wss://meet-next.openvidu.io/';

let pubRoom, subRoom, localVideoTrack, remoteVideoTrack, localMediaStream;
let currentScenario = null;

// ── Helpers ──

function simplifiedEncoding(encoding) {
  return {
    rid: encoding.rid,
    scalabilityMode: encoding.scalabilityMode,
    active: encoding.active,
    scaleResolutionDownBy: encoding.scaleResolutionDownBy,
    maxBitrate: encoding.maxBitrate,
    maxFramerate: encoding.maxFramerate,
    priority: encoding.priority,
    networkPriority: encoding.networkPriority,
  };
}

function logSenderParameters(sender, label) {
  const params = sender.getParameters();
  const snapshot = {
    degradationPreference: params.degradationPreference,
    encodings: (params.encodings ?? []).map(simplifiedEncoding),
    codecs: (params.codecs ?? []).map((codec) => ({
      mimeType: codec.mimeType,
      clockRate: codec.clockRate,
      payloadType: codec.payloadType,
      sdpFmtpLine: codec.sdpFmtpLine,
    })),
  };
  window.__lastVideoSenderParameters = snapshot;
  console.log(label, snapshot);
}

// ── Scenario Selection ──

function selectScenario(scenario) {
  currentScenario = scenario;

  // Highlight the active button
  document.querySelectorAll('.scenario-grid button').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('btn-' + scenario);
  if (btn) btn.classList.add('active');

  // Show/hide custom config
  document.getElementById('custom-config').style.display = scenario === 'custom' ? 'block' : 'none';

  // Update label & enable publish
  const labels = {
    screenshare: 'Screen Share — default simulcast',
    '2layers': 'Camera — 2 simulcast layers (default presets)',
    '3layers': 'Camera — 3 simulcast layers (default presets)',
    custom: 'Camera — Custom layers',
  };
  document.getElementById('scenario-label').textContent = labels[scenario] || scenario;
  document.getElementById('publish-btn').disabled = false;
}

// ── Custom Layer Management ──

let customLayerCounter = 0;

function addCustomLayer(w, h, bps, fps) {
  customLayerCounter++;
  const id = customLayerCounter;
  const container = document.getElementById('custom-layers');
  const row = document.createElement('div');
  row.className = 'layer-row';
  row.id = 'layer-' + id;
  row.innerHTML =
    '<span>Layer ' + id + ':</span>' +
    ' W <input type="number" class="lw" value="' + (w || 320) + '" style="width:60px">' +
    ' H <input type="number" class="lh" value="' + (h || 180) + '" style="width:60px">' +
    ' Bitrate (kbps) <input type="number" class="lbps" value="' + (bps || 125) + '" style="width:70px">' +
    ' FPS <input type="number" class="lfps" value="' + (fps || 15) + '" style="width:50px">' +
    ' <button onclick="removeCustomLayer(' + id + ')">Remove</button>';
  container.appendChild(row);
}

function removeCustomLayer(id) {
  const row = document.getElementById('layer-' + id);
  if (row) row.remove();
}

function getCustomLayers() {
  const rows = document.querySelectorAll('#custom-layers .layer-row');
  const layers = [];
  rows.forEach(row => {
    layers.push({
      width: parseInt(row.querySelector('.lw').value) || 320,
      height: parseInt(row.querySelector('.lh').value) || 180,
      maxBitrate: (parseInt(row.querySelector('.lbps').value) || 125) * 1000,
      maxFramerate: parseInt(row.querySelector('.lfps').value) || undefined,
    });
  });
  return layers;
}

// Initialize with two default custom layers
addCustomLayer(640, 360, 500, 20);
addCustomLayer(320, 180, 125, 15);

// ── Publish Options Builder ──

function buildPublishOptions() {
  const { ScreenSharePresets, VideoPresets, VideoPreset } = LivekitClient;

  const base = {
    videoCodec: 'vp8',
    backupCodec: false,
    simulcast: true,
    scalabilityMode: 'L1T3',
  };

  switch (currentScenario) {
    case 'screenshare':
      return {
        ...base,
        source: 'screen_share',
        screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
        screenShareSimulcastLayers: [ScreenSharePresets.h360fps15, ScreenSharePresets.h720fps15],
      };

    case '2layers':
      // Default: 2 simulcast layers = primary + 1 lower layer.
      // LiveKit default videoSimulcastLayers is [h180, h360], meaning primary is the 3rd.
      // For "2 layers" we provide just one simulcast layer so total = 2.
      return {
        ...base,
        source: 'camera',
        videoEncoding: VideoPresets.h720.encoding,
        videoSimulcastLayers: [VideoPresets.h180],
      };

    case '3layers':
      // Default: 3 simulcast layers = primary + 2 lower layers.
      return {
        ...base,
        source: 'camera',
        videoEncoding: VideoPresets.h1080.encoding,
        videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
      };

    case 'custom': {
      const pw = parseInt(document.getElementById('primary-w').value) || 1920;
      const ph = parseInt(document.getElementById('primary-h').value) || 1080;
      const pbps = (parseInt(document.getElementById('primary-bps').value) || 3000) * 1000;
      const pfps = parseInt(document.getElementById('primary-fps').value) || 30;

      const customLayers = getCustomLayers().map(
        l => new VideoPreset(l.width, l.height, l.maxBitrate, l.maxFramerate)
      );

      return {
        ...base,
        source: 'camera',
        videoEncoding: { maxBitrate: pbps, maxFramerate: pfps },
        videoSimulcastLayers: customLayers,
      };
    }

    default:
      throw new Error('No scenario selected');
  }
}

// ── Media Acquisition ──

async function createVideoStream(isScreenshare) {
  if (isScreenshare) {
    return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  }
  const pw = parseInt(document.getElementById('primary-w')?.value) || 1920;
  const ph = parseInt(document.getElementById('primary-h')?.value) || 1080;
  const pfps = parseInt(document.getElementById('primary-fps')?.value) || 30;
  return navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: pw }, height: { ideal: ph }, frameRate: { ideal: pfps } },
    audio: false,
  });
}

// ── Publish ──

async function publish() {
  if (!currentScenario) { alert('Select a scenario first'); return; }
  document.getElementById('publish-btn').disabled = true;

  pubRoom = new LivekitClient.Room({
    dynacast: false,
    adaptiveStream: false,
    publishDefaults: {
      videoCodec: 'vp8',
      backupCodec: false,
      simulcast: true,
      scalabilityMode: 'L1T3',
    },
  });
  await pubRoom.connect(LIVEKIT_URL, PUB_TOKEN);

  const isScreenshare = currentScenario === 'screenshare';
  localMediaStream = await createVideoStream(isScreenshare);
  const videoTrack = localMediaStream.getVideoTracks()[0];
  if (!videoTrack) throw new Error('No video track acquired');

  // Replace local preview
  const localEl = document.createElement('video');
  localEl.muted = true;
  localEl.autoplay = true;
  localEl.playsInline = true;
  localEl.srcObject = new MediaStream([videoTrack]);
  localEl.id = 'local-video';
  localEl.style.cssText = 'width:100%;background:#000;border-radius:6px';
  document.getElementById('local-video').replaceWith(localEl);

  const opts = buildPublishOptions();
  console.log('Publishing with options:', opts);
  const publication = await pubRoom.localParticipant.publishTrack(videoTrack, opts);
  localVideoTrack = publication.track;

  logSenderParameters(localVideoTrack.sender, 'Published video sender parameters');
  console.log('Published video track:', currentScenario);
}

// ── Subscribe ──

async function subscribe() {
  document.getElementById('subscribe-btn').disabled = true;
  subRoom = new LivekitClient.Room({
    dynacast: false,
    adaptiveStream: false,
  });

  subRoom.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (track.kind === LivekitClient.Track.Kind.Video) {
      remoteVideoTrack = track;
      const remoteEl = track.attach();
      remoteEl.id = 'remote-video';
      remoteEl.style.cssText = 'width:100%;max-height:600px;background:#000;border-radius:6px';
      document.getElementById('remote-video').replaceWith(remoteEl);
      console.log('Subscribed to remote video track');
    }
  });

  await subRoom.connect(LIVEKIT_URL, SUB_TOKEN, { autoSubscribe: true });
  console.log('Subscriber connected');
}

// ── Stats ──

async function getLayerStats(rtcObject) {
  const statsReport = await rtcObject.getStats();
  const layers = [];
  const codecs = new Map();
  statsReport.forEach((report) => {
    if (report.type === 'codec') codecs.set(report.id, report);
    if (report.type === 'outbound-rtp' || report.type === 'inbound-rtp') {
      layers.push({
        type: report.type,
        rid: report.rid,
        scalabilityMode: report.scalabilityMode,
        active: report.active,
        frameWidth: report.frameWidth,
        frameHeight: report.frameHeight,
        framesPerSecond: report.framesPerSecond,
        bytesSent: report.bytesSent,
        bytesReceived: report.bytesReceived,
        codecId: report.codecId,
      });
    }
  });
  layers.forEach((layer) => {
    if (codecs.has(layer.codecId)) layer.codec = codecs.get(layer.codecId).mimeType;
    delete layer.codecId;
  });
  return layers;
}

async function publisherStats() {
  if (!localVideoTrack?.sender) { alert('Publish first'); return; }
  const layers = await getLayerStats(localVideoTrack.sender);
  document.getElementById('stats-output').textContent =
    'Publisher Stats (outbound-rtp per simulcast layer):\n' + JSON.stringify(layers, null, 2);
}

async function subscriberStats() {
  if (!remoteVideoTrack?.receiver) { alert('Subscribe first'); return; }
  const layers = await getLayerStats(remoteVideoTrack.receiver);
  document.getElementById('stats-output').textContent =
    'Subscriber Stats (inbound-rtp):\n' + JSON.stringify(layers, null, 2);
}
