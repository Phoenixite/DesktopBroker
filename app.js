class WebSocketVideoStreamer {
    constructor() {
        // Telegram WebApp initialization
        this.telegramApp = window.Telegram.WebApp;
        this.telegramApp.ready();
        this.telegramApp.expand();
        
        // Configuration
        this.config = {
            currentEndpoint: '/screen/live',
            streamType: 'h264',
            mediaSource: null,
            sourceBuffer: null,
            isSourceBufferUpdating: false,
            mimeCodec: 'video/mp4; codecs="avc1.640028"', // VIDEO ONLY, no audio
            waitingForInitSegment: true,
            initSegmentReceived: false
        };
        
        // State variables
        this.ws = null;
        this.isConnected = false;
        this.chunkCount = 0;
        this.bytesReceived = 0;
        this.lastDataRateTime = Date.now();
        this.lastDataRateBytes = 0;
        this.mediaChunks = [];
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.bufferCleanupInterval = null;
        this.streamType = 'h264';
        this.lastInitSegmentTime = 0;
        this.initSegmentRefreshInterval = 30000; // Refresh init segment every 30s
        
        // DOM elements
        this.videoPlayer = document.getElementById('videoPlayer');
        this.connectBtn = document.getElementById('connectBtn');
        this.disconnectBtn = document.getElementById('disconnectBtn');
        this.debugBtn = document.getElementById('debugBtn');
        this.fullscreenBtn = document.getElementById('fullscreenBtn');
        this.saveConfigBtn = document.getElementById('saveConfigBtn');
        this.closeDebugBtn = document.getElementById('closeDebugBtn');
        this.h264Btn = document.getElementById('h264Btn');
        this.snapshotBtn = document.getElementById('snapshotBtn');
        this.statusIndicator = document.getElementById('status-indicator');
        this.statusText = document.getElementById('status-text');
        this.connectionInfo = document.getElementById('connectionInfo');
        this.videoInfo = document.getElementById('videoInfo');
        this.serverInput = document.getElementById('serverInput');
        this.fullUrlDisplay = document.getElementById('fullUrlDisplay');
        this.streamTypeElement = document.getElementById('streamType');
        this.dataRate = document.getElementById('dataRate');
        this.bufferSize = document.getElementById('bufferSize');
        this.latencyElement = document.getElementById('latency');
        this.bytesReceivedElement = document.getElementById('bytesReceived');
        this.chunkCountElement = document.getElementById('chunkCount');
        this.bufferHealth = document.getElementById('bufferHealth');
        this.wsState = document.getElementById('wsState');
        this.messageLog = document.getElementById('messageLog');
        this.debugPanel = document.getElementById('debugPanel');
        this.protocolInfo = document.getElementById('protocolInfo');
        this.dataTypeInfo = document.getElementById('dataTypeInfo');
        
        // Initialize
        this.init();
    }
    
    init() {
        this.loadConfig();
        this.setupEventListeners();
        this.updateFullUrlDisplay();
        this.updateUI();
        this.logMessage('App initialized', 'info');
        
        // Try multiple codec configurations
        this.tryCodecConfigurations();
    }
    
    tryCodecConfigurations() {
        // Try different codec configurations
        this.codecConfigs = [
            'video/mp4; codecs="avc1.640028"',           // H.264 High Profile, no audio
            'video/mp4; codecs="avc1.4d0028"',           // H.264 Main Profile
            'video/mp4; codecs="avc1.42e01e"',           // H.264 Baseline
            'video/mp4; codecs="avc1.42801e"',           // H.264 Constrained Baseline
            'video/mp4; codecs="mp4v.20.9"',             // MPEG-4 Visual
            'video/mp4'                                   // Generic MP4
        ];
        
        this.currentCodecIndex = 0;
    }
    
    setupMediaSource() {
        // Check browser support
        if (!('MediaSource' in window)) {
            this.showMessage('MediaSource API not supported in this browser', 'error');
            return;
        }
        
        // Close existing MediaSource if any
        if (this.config.mediaSource && this.config.mediaSource.readyState !== 'closed') {
            this.config.mediaSource.endOfStream();
            URL.revokeObjectURL(this.videoPlayer.src);
        }
        
        // Create new MediaSource
        this.config.mediaSource = new MediaSource();
        this.videoPlayer.src = URL.createObjectURL(this.config.mediaSource);
        
        this.config.mediaSource.addEventListener('sourceopen', () => {
            this.logMessage('MediaSource opened', 'info');
            this.setupSourceBuffer();
        });
        
        this.config.mediaSource.addEventListener('sourceended', () => {
            this.logMessage('MediaSource ended', 'info');
        });
        
        this.config.mediaSource.addEventListener('sourceclose', () => {
            this.logMessage('MediaSource closed', 'info');
        });
        
        this.config.mediaSource.addEventListener('error', (e) => {
            this.logMessage(`MediaSource error: ${e.message || 'Unknown'}`, 'error');
        });
    }
    
    setupSourceBuffer() {
        if (!this.config.mediaSource || this.config.mediaSource.readyState !== 'open') {
            return;
        }
        
        // Try current codec configuration
        const mimeCodec = this.codecConfigs[this.currentCodecIndex];
        
        try {
            if (!MediaSource.isTypeSupported(mimeCodec)) {
                this.logMessage(`Codec not supported: ${mimeCodec}`, 'warning');
                this.tryNextCodec();
                return;
            }
            
            this.config.sourceBuffer = this.config.mediaSource.addSourceBuffer(mimeCodec);
            this.config.sourceBuffer.mode = 'segments';
            this.config.mimeCodec = mimeCodec;
            
            this.config.sourceBuffer.addEventListener('updateend', () => {
                this.config.isSourceBufferUpdating = false;
                this.appendQueuedChunks();
            });
            
            this.config.sourceBuffer.addEventListener('update', () => {
                this.logMessage('SourceBuffer updated', 'debug');
            });
            
            this.config.sourceBuffer.addEventListener('error', (e) => {
                this.logMessage(`SourceBuffer error: ${e.message || 'Unknown'}`, 'error');
                // Try next codec on error
                if (this.currentCodecIndex < this.codecConfigs.length - 1) {
                    this.tryNextCodec();
                }
            });
            
            this.config.waitingForInitSegment = true;
            this.config.initSegmentReceived = false;
            this.mediaChunks = [];
            
            this.logMessage(`SourceBuffer created with codec: ${mimeCodec}`, 'info');
            this.logMessage(`MediaSource readyState: ${this.config.mediaSource.readyState}`, 'info');
            
        } catch (e) {
            this.logMessage(`Error creating SourceBuffer: ${e.message}`, 'error');
            this.tryNextCodec();
        }
    }
    
    tryNextCodec() {
        if (this.currentCodecIndex < this.codecConfigs.length - 1) {
            this.currentCodecIndex++;
            this.logMessage(`Trying next codec: ${this.codecConfigs[this.currentCodecIndex]}`, 'info');
            
            // Clean up old source buffer
            if (this.config.sourceBuffer) {
                try {
                    this.config.sourceBuffer.abort();
                    if (this.config.mediaSource.readyState === 'open') {
                        this.config.mediaSource.removeSourceBuffer(this.config.sourceBuffer);
                    }
                } catch (e) {
                    // Ignore cleanup errors
                }
                this.config.sourceBuffer = null;
            }
            
            // Setup with new codec
            this.setupSourceBuffer();
        } else {
            this.logMessage('All codec configurations failed', 'error');
            this.showMessage('Cannot play video stream with any available codec', 'error');
        }
    }
    
    setupEventListeners() {
        this.connectBtn.addEventListener('click', () => this.connect());
        this.disconnectBtn.addEventListener('click', () => this.disconnect());
        this.debugBtn.addEventListener('click', () => this.toggleDebugPanel());
        this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
        this.saveConfigBtn.addEventListener('click', () => this.saveConfig());
        this.closeDebugBtn.addEventListener('click', () => this.toggleDebugPanel());
        
        // Stream type selection
        this.h264Btn.addEventListener('click', () => this.selectStreamType('h264'));
        this.snapshotBtn.addEventListener('click', () => this.selectStreamType('snapshot'));
        
        // Update URL when server input changes
        this.serverInput.addEventListener('input', () => this.updateFullUrlDisplay());
        
        // Handle Enter key
        this.serverInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.connect();
        });
        
        // Video events
        this.videoPlayer.addEventListener('loadeddata', () => {
            this.logMessage('Video data loaded', 'info');
            const dimensions = `${this.videoPlayer.videoWidth}x${this.videoPlayer.videoHeight}`;
            this.videoInfo.textContent = `Playing ${dimensions}`;
            this.logMessage(`Video dimensions: ${dimensions}`, 'info');
        });
        
        this.videoPlayer.addEventListener('loadedmetadata', () => {
            this.logMessage('Video metadata loaded', 'info');
        });
        
        this.videoPlayer.addEventListener('canplay', () => {
            this.logMessage('Video can play', 'info');
            this.videoInfo.textContent = 'Ready to play';
        });
        
        this.videoPlayer.addEventListener('playing', () => {
            this.logMessage('Video started playing', 'info');
            this.videoInfo.textContent = 'Playing';
        });
        
        this.videoPlayer.addEventListener('waiting', () => {
            this.logMessage('Video waiting for data', 'warning');
            this.videoInfo.textContent = 'Buffering...';
        });
        
        this.videoPlayer.addEventListener('error', (e) => {
            const errorMsg = this.getVideoError();
            this.logMessage(`Video error: ${errorMsg}`, 'error');
            this.videoInfo.textContent = `Error: ${errorMsg}`;
        });
        
        // Handle visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !this.isConnected) {
                this.connect();
            }
        });
        
        // Start buffer cleanup interval
        this.bufferCleanupInterval = setInterval(() => {
            this.cleanupBuffer();
        }, 1000);
    }
    
    getVideoError() {
        if (!this.videoPlayer.error) return 'Unknown error';
        
        switch(this.videoPlayer.error.code) {
            case MediaError.MEDIA_ERR_ABORTED:
                return 'Playback aborted';
            case MediaError.MEDIA_ERR_NETWORK:
                return 'Network error';
            case MediaError.MEDIA_ERR_DECODE:
                return 'Decoding error';
            case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                return 'Video format not supported';
            default:
                return `Code ${this.videoPlayer.error.code}`;
        }
    }
    
    selectStreamType(type) {
        this.streamType = type;
        
        // Update UI
        this.h264Btn.classList.toggle('active', type === 'h264');
        this.snapshotBtn.classList.toggle('active', type === 'snapshot');
        
        // Update endpoint
        this.config.currentEndpoint = type === 'h264' ? '/screen/live' : '/screen/snapstream';
        
        // Update info display
        if (type === 'h264') {
            this.protocolInfo.textContent = 'H.264 MP4 over WebSocket';
            this.dataTypeInfo.textContent = 'Binary MP4 fragments';
            this.streamTypeElement.textContent = 'H.264';
            
            // Setup MediaSource for H.264
            this.setupMediaSource();
        } else {
            this.protocolInfo.textContent = 'JPEG snapshots over WebSocket';
            this.dataTypeInfo.textContent = 'Binary JPEG images';
            this.streamTypeElement.textContent = 'Snapshot';
            
            // Clean up MediaSource resources
            this.cleanupMediaSource();
        }
        
        this.updateFullUrlDisplay();
        this.logMessage(`Selected ${type} stream`, 'info');
        
        // Disconnect if currently connected
        if (this.isConnected) {
            this.disconnect();
            setTimeout(() => this.connect(), 500);
        }
    }
    
    updateFullUrlDisplay() {
        const server = this.serverInput.value.trim();
        
        if (!server) {
            this.fullUrlDisplay.textContent = 'Enter server URL';
            return;
        }
        
        // Ensure server starts with ws:// or wss://
        let fullUrl = server.startsWith('ws://') || server.startsWith('wss://') 
            ? server 
            : 'wss://' + server;
        
        // Add endpoint
        fullUrl += this.config.currentEndpoint;
        
        this.fullUrlDisplay.textContent = fullUrl;
    }
    
    getFullWebSocketUrl() {
        const server = this.serverInput.value.trim();
        
        if (!server) {
            this.showMessage('Please enter a server URL', 'error');
            return null;
        }
        
        // Construct full URL
        let fullUrl = server.startsWith('ws://') || server.startsWith('wss://') 
            ? server 
            : 'wss://' + server;
        
        fullUrl += this.config.currentEndpoint;
        
        return fullUrl;
    }
    
    connect() {
        if (this.isConnected) return;
        
        const wsUrl = this.getFullWebSocketUrl();
        if (!wsUrl) return;
        
        this.updateStatus('Connecting...', 'connecting');
        this.connectionInfo.textContent = `Connecting to ${wsUrl}`;
        this.logMessage(`Connecting to ${wsUrl}`, 'info');
        
        try {
            this.ws = new WebSocket(wsUrl);
            this.updateWsState();
            
            // IMPORTANT: Set binary type to arraybuffer
            this.ws.binaryType = 'arraybuffer';
            
            this.ws.onopen = () => {
                console.log('WebSocket connected to:', wsUrl);
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.updateStatus('Connected', 'connected');
                this.updateUI();
                this.connectionInfo.textContent = 'Receiving stream data...';
                this.showMessage('Connected successfully!', 'success');
                this.logMessage('WebSocket connection opened', 'info');
                this.updateWsState();
                
                // Reset stats
                this.chunkCount = 0;
                this.bytesReceived = 0;
                this.lastDataRateTime = Date.now();
                this.lastDataRateBytes = 0;
                this.lastInitSegmentTime = 0;
                
                // Reset init segment flags
                this.config.waitingForInitSegment = true;
                this.config.initSegmentReceived = false;
                
                // Clear any existing chunks
                this.mediaChunks = [];
                
                // For H.264, make sure MediaSource is ready
                if (this.streamType === 'h264') {
                    // Reset to first codec
                    this.currentCodecIndex = 0;
                    
                    if (!this.config.mediaSource || this.config.mediaSource.readyState === 'closed') {
                        this.setupMediaSource();
                    }
                }
            };
            
            this.ws.onmessage = (event) => {
                this.handleIncomingData(event.data);
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.updateStatus('Connection error', 'error');
                this.connectionInfo.textContent = 'WebSocket error';
                this.showMessage('WebSocket connection error', 'error');
                this.logMessage(`WebSocket error: ${error.type || 'Unknown'}`, 'error');
                this.updateWsState();
            };
            
            this.ws.onclose = (event) => {
                this.isConnected = false;
                console.log('WebSocket disconnected:', event.code, event.reason);
                
                this.updateStatus('Disconnected', 'disconnected');
                this.connectionInfo.textContent = `Disconnected. Code: ${event.code}`;
                this.updateUI();
                this.logMessage(`WebSocket closed: ${event.code} - ${event.reason}`, 'info');
                this.updateWsState();
                
                // Attempt reconnection
                if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    const delay = 2000 * this.reconnectAttempts;
                    this.connectionInfo.textContent += ` | Reconnecting in ${delay/1000}s...`;
                    
                    setTimeout(() => {
                        if (!this.isConnected) {
                            this.connect();
                        }
                    }, delay);
                }
            };
            
        } catch (error) {
            console.error('Failed to create WebSocket:', error);
            this.updateStatus('Connection failed', 'error');
            this.connectionInfo.textContent = `Failed: ${error.message}`;
            this.showMessage('Invalid WebSocket URL', 'error');
            this.logMessage(`Failed to create WebSocket: ${error.message}`, 'error');
        }
    }
    
    handleIncomingData(data) {
        this.chunkCount++;
        const dataSize = data.byteLength || data.size || 0;
        this.bytesReceived += dataSize;
        
        // Update stats
        const now = Date.now();
        if (now - this.lastDataRateTime >= 1000) {
            const bytesSinceLast = this.bytesReceived - this.lastDataRateBytes;
            const kbps = (bytesSinceLast * 8) / 1024;
            this.dataRate.textContent = `${kbps.toFixed(1)} kbps`;
            this.lastDataRateTime = now;
            this.lastDataRateBytes = this.bytesReceived;
        }
        
        // Update debug display
        this.bytesReceivedElement.textContent = this.formatBytes(this.bytesReceived);
        this.chunkCountElement.textContent = this.chunkCount;
        
        // Log chunk info
        this.logMessage(`Received chunk ${this.chunkCount}: ${this.formatBytes(dataSize)}`, 'debug');
        
        // Handle data based on stream type
        if (this.streamType === 'h264') {
            this.handleH264Data(data);
        } else {
            this.handleSnapshotData(data);
        }
    }
    
    handleH264Data(data) {
        // Data should be ArrayBuffer from FFmpeg
        if (!(data instanceof ArrayBuffer)) {
            this.logMessage(`Received non-ArrayBuffer data: ${typeof data}`, 'warning');
            return;
        }
        
        // Check if this looks like an initialization segment (small chunk at beginning)
        const isSmallChunk = data.byteLength < 1024; // Less than 1KB
        const isFirstChunks = this.chunkCount <= 3;
        
        if ((isSmallChunk && isFirstChunks) || this.config.waitingForInitSegment) {
            this.logMessage('Detected possible initialization segment', 'info');
            this.config.waitingForInitSegment = false;
            this.config.initSegmentReceived = true;
            this.lastInitSegmentTime = Date.now();
            
            // Clear buffer before appending init segment
            if (this.config.sourceBuffer && this.config.mediaSource.readyState === 'open') {
                try {
                    this.config.sourceBuffer.abort();
                    
                    // Remove existing data
                    if (this.config.sourceBuffer.buffered.length > 0) {
                        for (let i = 0; i < this.config.sourceBuffer.buffered.length; i++) {
                            const start = this.config.sourceBuffer.buffered.start(i);
                            const end = this.config.sourceBuffer.buffered.end(i);
                            this.config.sourceBuffer.remove(start, end);
                        }
                    }
                    
                    // Append init segment
                    this.config.isSourceBufferUpdating = true;
                    this.config.sourceBuffer.appendBuffer(data);
                    this.logMessage('Appended initialization segment', 'info');
                    return;
                    
                } catch (e) {
                    this.logMessage(`Error handling init segment: ${e.message}`, 'error');
                    this.config.isSourceBufferUpdating = false;
                }
            }
        }
        
        // Check if we need to refresh init segment
        const timeSinceInit = Date.now() - this.lastInitSegmentTime;
        if (timeSinceInit > this.initSegmentRefreshInterval) {
            this.logMessage('Requesting new init segment (periodic refresh)', 'info');
            this.config.waitingForInitSegment = true;
            this.config.initSegmentReceived = false;
        }
        
        // Store media chunk
        this.mediaChunks.push(data);
        
        // Append if buffer is ready
        if (this.config.sourceBuffer && !this.config.isSourceBufferUpdating && 
            this.config.mediaSource.readyState === 'open' && this.config.initSegmentReceived) {
            this.appendQueuedChunks();
        }
    }
    
    handleSnapshotData(data) {
        // Data is JPEG binary
        if (data instanceof ArrayBuffer || data instanceof Blob) {
            const blob = data instanceof ArrayBuffer 
                ? new Blob([data], { type: 'image/jpeg' })
                : data;
            
            const imageUrl = URL.createObjectURL(blob);
            
            if (!this.snapshotImage) {
                this.snapshotImage = document.createElement('img');
                this.snapshotImage.style.width = '100%';
                this.snapshotImage.style.height = '100%';
                this.snapshotImage.style.objectFit = 'contain';
                this.videoPlayer.style.display = 'none';
                this.videoPlayer.parentNode.appendChild(this.snapshotImage);
            }
            
            this.snapshotImage.src = imageUrl;
            this.videoInfo.textContent = `Snapshot #${this.chunkCount}`;
            
            // Clean up previous URL
            if (this.lastSnapshotUrl) {
                URL.revokeObjectURL(this.lastSnapshotUrl);
            }
            this.lastSnapshotUrl = imageUrl;
            
            this.logMessage(`Displayed snapshot: ${this.formatBytes(blob.size)}`, 'debug');
        }
    }
    
    appendQueuedChunks() {
        if (!this.config.sourceBuffer || this.config.isSourceBufferUpdating || 
            this.mediaChunks.length === 0 || !this.config.initSegmentReceived) {
            return;
        }
        
        try {
            this.config.isSourceBufferUpdating = true;
            const chunk = this.mediaChunks.shift();
            
            // Log some info about the chunk
            const view = new Uint8Array(chunk.slice(0, Math.min(16, chunk.byteLength)));
            const hex = Array.from(view).map(b => b.toString(16).padStart(2, '0')).join(' ');
            this.logMessage(`Appending chunk (first 16 bytes): ${hex}`, 'debug');
            
            this.config.sourceBuffer.appendBuffer(chunk);
            
            // Update buffer health
            this.updateBufferHealth();
            
        } catch (e) {
            this.config.isSourceBufferUpdating = false;
            this.logMessage(`Error appending buffer: ${e.message}`, 'error');
            
            // Try next codec on append error
            if (e.name === 'QuotaExceededError' || e.message.includes('codec')) {
                if (this.currentCodecIndex < this.codecConfigs.length - 1) {
                    this.tryNextCodec();
                }
            }
        }
    }
    
    updateBufferHealth() {
        if (!this.config.sourceBuffer || this.config.sourceBuffer.buffered.length === 0) {
            return;
        }
        
        try {
            const end = this.config.sourceBuffer.buffered.end(this.config.sourceBuffer.buffered.length - 1);
            const currentTime = this.videoPlayer.currentTime;
            const bufferDuration = end - currentTime;
            
            this.bufferHealth.textContent = `${Math.min(100, (bufferDuration / 5) * 100).toFixed(0)}%`;
            this.bufferSize.textContent = `${bufferDuration.toFixed(2)}s`;
            
            // Auto-play if enough buffer
            if (bufferDuration > 0.5 && this.videoPlayer.paused) {
                this.videoPlayer.play().catch(e => {
                    this.logMessage(`Auto-play failed: ${e.message}`, 'warning');
                });
            }
            
        } catch (e) {
            // Ignore buffer reading errors
        }
    }
    
    cleanupBuffer() {
        if (!this.config.sourceBuffer || this.config.sourceBuffer.buffered.length === 0) {
            return;
        }
        
        const currentTime = this.videoPlayer.currentTime;
        
        // Remove buffered data older than 5 seconds
        for (let i = 0; i < this.config.sourceBuffer.buffered.length; i++) {
            const start = this.config.sourceBuffer.buffered.start(i);
            const end = this.config.sourceBuffer.buffered.end(i);
            
            if (end < currentTime - 5) {
                try {
                    this.config.sourceBuffer.remove(start, end);
                    this.logMessage(`Cleaned buffer: ${start.toFixed(1)}-${end.toFixed(1)}`, 'debug');
                } catch (e) {
                    // Ignore cleanup errors
                }
            }
        }
    }
    
    cleanupMediaSource() {
        if (this.config.mediaSource) {
            try {
                if (this.config.mediaSource.readyState === 'open') {
                    this.config.mediaSource.endOfStream();
                }
                URL.revokeObjectURL(this.videoPlayer.src);
            } catch (e) {
                // Ignore cleanup errors
            }
            this.config.mediaSource = null;
            this.config.sourceBuffer = null;
        }
        
        // Remove snapshot image if exists
        if (this.snapshotImage) {
            this.snapshotImage.remove();
            this.snapshotImage = null;
            this.videoPlayer.style.display = 'block';
        }
        
        if (this.lastSnapshotUrl) {
            URL.revokeObjectURL(this.lastSnapshotUrl);
            this.lastSnapshotUrl = null;
        }
    }
    
    disconnect() {
        if (this.ws) {
            this.ws.close(1000, 'User disconnected');
            this.ws = null;
        }
        this.isConnected = false;
        this.updateUI();
        this.updateStatus('Disconnected', 'disconnected');
        this.showMessage('Disconnected from server', 'info');
        this.logMessage('Disconnected by user', 'info');
        this.updateWsState();
        
        // Clean up snapshot resources
        if (this.lastSnapshotUrl) {
            URL.revokeObjectURL(this.lastSnapshotUrl);
            this.lastSnapshotUrl = null;
        }
    }
    
    toggleDebugPanel() {
        this.debugPanel.style.display = this.debugPanel.style.display === 'none' ? 'block' : 'none';
    }
    
    toggleFullscreen() {
        if (!document.fullscreenElement) {
            if (this.videoPlayer.requestFullscreen) {
                this.videoPlayer.requestFullscreen();
            } else if (this.videoPlayer.webkitRequestFullscreen) {
                this.videoPlayer.webkitRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    }
    
    updateWsState() {
        if (!this.ws) {
            this.wsState.textContent = 'CLOSED';
            return;
        }
        
        switch(this.ws.readyState) {
            case WebSocket.CONNECTING:
                this.wsState.textContent = 'CONNECTING';
                break;
            case WebSocket.OPEN:
                this.wsState.textContent = 'OPEN';
                break;
            case WebSocket.CLOSING:
                this.wsState.textContent = 'CLOSING';
                break;
            case WebSocket.CLOSED:
                this.wsState.textContent = 'CLOSED';
                break;
        }
    }
    
    logMessage(message, type = 'info') {
        console.log(`[${type.toUpperCase()}] ${message}`);
        
        // Add to debug panel
        if (this.messageLog) {
            const messageElement = document.createElement('div');
            messageElement.className = `log-message log-${type}`;
            messageElement.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
            
            this.messageLog.prepend(messageElement);
            
            // Keep only last 20 messages
            const messages = this.messageLog.querySelectorAll('.log-message');
            if (messages.length > 20) {
                messages[messages.length - 1].remove();
            }
        }
    }
    
    updateStatus(text, state) {
        this.statusText.textContent = text;
        
        // Update indicator color
        this.statusIndicator.className = 'status-indicator';
        switch(state) {
            case 'connected':
                this.statusIndicator.classList.add('status-online');
                break;
            case 'connecting':
                this.statusIndicator.classList.add('status-connecting');
                break;
            case 'error':
                this.statusIndicator.classList.add('status-error');
                break;
            default:
                this.statusIndicator.classList.add('status-offline');
        }
    }
    
    updateUI() {
        this.connectBtn.disabled = this.isConnected;
        this.disconnectBtn.disabled = !this.isConnected;
        this.serverInput.disabled = this.isConnected;
        
        if (this.isConnected) {
            this.connectBtn.textContent = 'Connected';
            this.disconnectBtn.textContent = 'Disconnect';
        } else {
            this.connectBtn.textContent = 'Connect to Stream';
            this.disconnectBtn.textContent = 'Disconnected';
        }
    }
    
    loadConfig() {
        const savedServer = localStorage.getItem('videoStreamer_server');
        if (savedServer) {
            this.serverInput.value = savedServer;
        }
    }
    
    saveConfig() {
        const server = this.serverInput.value.trim();
        localStorage.setItem('videoStreamer_server', server);
        this.showMessage('Configuration saved!', 'success');
    }
    
    showMessage(message, type = 'info') {
        const messageEl = document.createElement('div');
        messageEl.className = `message message-${type}`;
        messageEl.textContent = message;
        
        messageEl.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            background: ${type === 'success' ? '#4CAF50' : 
                        type === 'error' ? '#F44336' : 
                        type === 'info' ? '#2196F3' : '#FF9800'};
            color: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;
        
        document.body.appendChild(messageEl);
        
        setTimeout(() => {
            messageEl.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => messageEl.remove(), 300);
        }, 3000);
    }
    
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    const streamer = new WebSocketVideoStreamer();
    window.videoStreamer = streamer;
});

// Cleanup
window.addEventListener('beforeunload', () => {
    if (window.videoStreamer) {
        window.videoStreamer.disconnect();
        if (window.videoStreamer.bufferCleanupInterval) {
            clearInterval(window.videoStreamer.bufferCleanupInterval);
        }
    }
});