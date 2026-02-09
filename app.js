class WebSocketVideoStreamer {
    constructor() {
        // Telegram WebApp initialization
        this.telegramApp = window.Telegram.WebApp;
        this.telegramApp.ready();
        this.telegramApp.expand();
        
        // WebSocket configuration
        this.wsBaseUrl = 'wss://competing-horn-advocacy-alfred.trycloudflare.trycloudflare.com';
        this.wsEndpoint = '/screen/live';
        this.wsUrl = this.wsBaseUrl + this.wsEndpoint;
        
        // State variables
        this.ws = null;
        this.isConnected = false;
        this.frameCount = 0;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 2000;
        
        // DOM elements
        this.videoPlayer = document.getElementById('videoPlayer');
        this.connectBtn = document.getElementById('connectBtn');
        this.disconnectBtn = document.getElementById('disconnectBtn');
        this.fullscreenBtn = document.getElementById('fullscreenBtn');
        this.statusIndicator = document.getElementById('status-indicator');
        this.statusText = document.getElementById('status-text');
        this.frameCountElement = document.getElementById('frameCount');
        this.connectionQuality = document.getElementById('connectionQuality');
        this.connectionInfo = document.getElementById('connectionInfo');
        
        // Initialize
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.updateUI();
        
        // Attempt auto-connect on launch
        setTimeout(() => this.connect(), 1000);
    }
    
    setupEventListeners() {
        this.connectBtn.addEventListener('click', () => this.connect());
        this.disconnectBtn.addEventListener('click', () => this.disconnect());
        this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
        
        // Handle visibility change for reconnect
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !this.isConnected) {
                this.connect();
            }
        });
    }
    
    connect() {
        if (this.isConnected) return;
        
        this.updateStatus('Connecting...', 'connecting');
        
        try {
            this.ws = new WebSocket(this.wsUrl);
            
            this.ws.onopen = () => {
                console.log('WebSocket connected to:', this.wsUrl);
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.updateStatus('Connected', 'connected');
                this.updateUI();
                this.connectionInfo.textContent = 'Streaming live video...';
            };
            
            this.ws.onmessage = (event) => {
                this.handleVideoData(event.data);
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.updateStatus('Connection error', 'error');
                this.connectionInfo.textContent = 'Connection error. Retrying...';
            };
            
            this.ws.onclose = (event) => {
                this.isConnected = false;
                console.log('WebSocket disconnected:', event.code, event.reason);
                this.updateStatus('Disconnected', 'disconnected');
                this.connectionInfo.textContent = 'Connection closed. Click Connect to retry.';
                this.updateUI();
                
                // Attempt reconnection if not intentionally disconnected
                if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    setTimeout(() => this.connect(), this.reconnectDelay * this.reconnectAttempts);
                }
            };
            
        } catch (error) {
            console.error('Failed to create WebSocket:', error);
            this.updateStatus('Connection failed', 'error');
        }
    }
    
    handleVideoData(data) {
        this.frameCount++;
        this.frameCountElement.textContent = this.frameCount;
        
        // Update connection quality indicator
        if (this.frameCount % 30 === 0) {
            this.updateConnectionQuality();
        }
        
        // Assuming video data is received as binary or base64
        if (data instanceof Blob) {
            const videoUrl = URL.createObjectURL(data);
            this.videoPlayer.src = videoUrl;
        } else if (typeof data === 'string') {
            // If it's base64 encoded
            if (data.startsWith('data:video/') || data.startsWith('data:image/')) {
                this.videoPlayer.src = data;
            } else {
                // Try to parse as JSON containing video data
                try {
                    const jsonData = JSON.parse(data);
                    if (jsonData.videoData) {
                        this.videoPlayer.src = jsonData.videoData;
                    }
                } catch (e) {
                    console.log('Received text data:', data.substring(0, 100));
                }
            }
        }
    }
    
    updateConnectionQuality() {
        // Simple quality indicator based on frame rate
        const quality = this.isConnected ? 'Good' : 'Poor';
        this.connectionQuality.textContent = quality;
        this.connectionQuality.className = quality === 'Good' ? 'quality-good' : 'quality-poor';
    }
    
    disconnect() {
        if (this.ws) {
            this.ws.close(1000, 'User disconnected');
            this.ws = null;
        }
        this.isConnected = false;
        this.updateUI();
        this.updateStatus('Disconnected', 'disconnected');
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
        
        if (this.isConnected) {
            this.connectBtn.textContent = 'Connected';
            this.disconnectBtn.textContent = 'Disconnect';
        } else {
            this.connectBtn.textContent = 'Connect to Stream';
            this.disconnectBtn.textContent = 'Disconnected';
        }
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new WebSocketVideoStreamer();
});

// Handle Telegram WebApp events
window.addEventListener('beforeunload', () => {
    // Cleanup WebSocket connection
    const streamer = new WebSocketVideoStreamer();
    streamer.disconnect();
});