class WebSocketVideoStreamer {
    constructor() {
        // Telegram WebApp initialization
        this.telegramApp = window.Telegram.WebApp;
        this.telegramApp.ready();
        this.telegramApp.expand();
        
        // Configuration
        this.config = {
            defaultServers: {
                'byte-carter-rim-that': 'wss://byte-carter-rim-that.trycloudflare.com',
                'local': 'ws://localhost:8080',
                'custom': ''
            },
            defaultEndpoint: '/screen/live',
            maxRecentServers: 5,
            reconnectDelay: 2000,
            maxReconnectAttempts: 5
        };
        
        // State variables
        this.ws = null;
        this.isConnected = false;
        this.frameCount = 0;
        this.reconnectAttempts = 0;
        this.connectionStartTime = null;
        this.latency = null;
        this.recentServers = [];
        
        // DOM elements
        this.videoPlayer = document.getElementById('videoPlayer');
        this.connectBtn = document.getElementById('connectBtn');
        this.disconnectBtn = document.getElementById('disconnectBtn');
        this.testBtn = document.getElementById('testBtn');
        this.fullscreenBtn = document.getElementById('fullscreenBtn');
        this.saveConfigBtn = document.getElementById('saveConfigBtn');
        this.statusIndicator = document.getElementById('status-indicator');
        this.statusText = document.getElementById('status-text');
        this.frameCountElement = document.getElementById('frameCount');
        this.connectionQuality = document.getElementById('connectionQuality');
        this.connectionInfo = document.getElementById('connectionInfo');
        this.serverInput = document.getElementById('serverInput');
        this.endpointInput = document.getElementById('endpointInput');
        this.fullUrlDisplay = document.getElementById('fullUrlDisplay');
        this.recentServersList = document.getElementById('recentServersList');
        this.latencyElement = document.getElementById('latency');
        
        // Initialize
        this.init();
    }
    
    init() {
        this.loadConfig();
        this.setupEventListeners();
        this.updateFullUrlDisplay();
        this.updateUI();
        this.loadRecentServers();
    }
    
    loadConfig() {
        // Try to load saved configuration from localStorage
        const savedServer = localStorage.getItem('videoStreamer_server');
        const savedEndpoint = localStorage.getItem('videoStreamer_endpoint');
        
        if (savedServer) {
            this.serverInput.value = savedServer;
        }
        
        if (savedEndpoint) {
            this.endpointInput.value = savedEndpoint;
        }
    }
    
    saveConfig() {
        const server = this.serverInput.value.trim();
        const endpoint = this.endpointInput.value.trim();
        
        localStorage.setItem('videoStreamer_server', server);
        localStorage.setItem('videoStreamer_endpoint', endpoint);
        
        // Add to recent servers
        this.addToRecentServers(server);
        
        // Show confirmation
        this.showMessage('Configuration saved!', 'success');
    }
    
    addToRecentServers(serverUrl) {
        if (!serverUrl) return;
        
        // Remove if already exists
        this.recentServers = this.recentServers.filter(s => s !== serverUrl);
        
        // Add to beginning
        this.recentServers.unshift(serverUrl);
        
        // Keep only last N servers
        if (this.recentServers.length > this.config.maxRecentServers) {
            this.recentServers.pop();
        }
        
        // Save to localStorage
        localStorage.setItem('videoStreamer_recentServers', JSON.stringify(this.recentServers));
        
        // Update UI
        this.updateRecentServersList();
    }
    
    loadRecentServers() {
        const saved = localStorage.getItem('videoStreamer_recentServers');
        if (saved) {
            try {
                this.recentServers = JSON.parse(saved);
                this.updateRecentServersList();
            } catch (e) {
                console.error('Error loading recent servers:', e);
            }
        }
    }
    
    updateRecentServersList() {
        this.recentServersList.innerHTML = '';
        
        this.recentServers.forEach(server => {
            const serverItem = document.createElement('div');
            serverItem.className = 'server-item';
            serverItem.innerHTML = `
                <span class="server-url">${server}</span>
                <button class="btn-use-server" data-server="${server}">Use</button>
            `;
            this.recentServersList.appendChild(serverItem);
        });
        
        // Add event listeners to use buttons
        document.querySelectorAll('.btn-use-server').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const server = e.target.getAttribute('data-server');
                this.serverInput.value = server;
                this.updateFullUrlDisplay();
            });
        });
    }
    
    setupEventListeners() {
        this.connectBtn.addEventListener('click', () => this.connect());
        this.disconnectBtn.addEventListener('click', () => this.disconnect());
        this.testBtn.addEventListener('click', () => this.testConnection());
        this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
        this.saveConfigBtn.addEventListener('click', () => this.saveConfig());
        
        // Update full URL when inputs change
        this.serverInput.addEventListener('input', () => this.updateFullUrlDisplay());
        this.endpointInput.addEventListener('input', () => this.updateFullUrlDisplay());
        
        // Preset buttons
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const preset = e.target.getAttribute('data-preset');
                this.applyPreset(preset);
            });
        });
        
        // Handle Enter key in server input
        this.serverInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.connect();
            }
        });
        
        // Handle visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !this.isConnected) {
                this.connect();
            }
        });
    }
    
    applyPreset(preset) {
        if (preset === 'custom') {
            this.serverInput.value = '';
            this.serverInput.focus();
        } else if (this.config.defaultServers[preset]) {
            this.serverInput.value = this.config.defaultServers[preset];
        }
        this.updateFullUrlDisplay();
    }
    
    updateFullUrlDisplay() {
        const server = this.serverInput.value.trim();
        const endpoint = this.endpointInput.value.trim();
        
        if (!server) {
            this.fullUrlDisplay.textContent = 'Enter server URL';
            return;
        }
        
        // Ensure server starts with ws:// or wss://
        let fullUrl = server;
        if (!server.startsWith('ws://') && !server.startsWith('wss://')) {
            fullUrl = 'wss://' + server;
        }
        
        // Add endpoint if provided
        if (endpoint) {
            fullUrl += endpoint.startsWith('/') ? endpoint : '/' + endpoint;
        }
        
        this.fullUrlDisplay.textContent = fullUrl;
    }
    
    getFullWebSocketUrl() {
        const server = this.serverInput.value.trim();
        const endpoint = this.endpointInput.value.trim();
        
        if (!server) {
            this.showMessage('Please enter a server URL', 'error');
            return null;
        }
        
        // Construct full URL
        let fullUrl = server;
        if (!server.startsWith('ws://') && !server.startsWith('wss://')) {
            fullUrl = 'wss://' + server;
        }
        
        if (endpoint) {
            fullUrl += endpoint.startsWith('/') ? endpoint : '/' + endpoint;
        }
        
        return fullUrl;
    }
    
    connect() {
        if (this.isConnected) return;
        
        const wsUrl = this.getFullWebSocketUrl();
        if (!wsUrl) return;
        
        this.updateStatus('Connecting...', 'connecting');
        this.connectionStartTime = Date.now();
        this.connectionInfo.textContent = `Connecting to ${wsUrl}`;
        
        try {
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('WebSocket connected to:', wsUrl);
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.updateStatus('Connected', 'connected');
                this.updateUI();
                this.connectionInfo.textContent = 'Streaming live video...';
                this.showMessage('Connected successfully!', 'success');
                
                // Add to recent servers
                this.addToRecentServers(this.serverInput.value.trim());
            };
            
            this.ws.onmessage = (event) => {
                this.handleVideoData(event.data);
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.updateStatus('Connection error', 'error');
                this.connectionInfo.textContent = `Error: ${error.type || 'Unknown error'}`;
                this.showMessage('Connection failed', 'error');
            };
            
            this.ws.onclose = (event) => {
                this.isConnected = false;
                console.log('WebSocket disconnected:', event.code, event.reason);
                
                const duration = this.connectionStartTime ? 
                    Math.round((Date.now() - this.connectionStartTime) / 1000) : 0;
                
                this.updateStatus('Disconnected', 'disconnected');
                this.connectionInfo.textContent = `Disconnected after ${duration}s. Code: ${event.code}`;
                this.updateUI();
                
                // Attempt reconnection if not intentionally disconnected
                if (event.code !== 1000 && this.reconnectAttempts < this.config.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    const delay = this.config.reconnectDelay * this.reconnectAttempts;
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
            this.connectionInfo.textContent = `Failed to create connection: ${error.message}`;
            this.showMessage('Invalid WebSocket URL', 'error');
        }
    }
    
    async testConnection() {
        const wsUrl = this.getFullWebSocketUrl();
        if (!wsUrl) return;
        
        this.updateStatus('Testing...', 'connecting');
        this.connectionInfo.textContent = `Testing connection to ${wsUrl}`;
        
        try {
            // Create a test connection that times out after 5 seconds
            const testWs = new WebSocket(wsUrl);
            
            const timeout = setTimeout(() => {
                testWs.close();
                this.updateStatus('Test timeout', 'error');
                this.connectionInfo.textContent = 'Connection test timed out (5s)';
                this.showMessage('Server not responding', 'error');
            }, 5000);
            
            testWs.onopen = () => {
                clearTimeout(timeout);
                const latency = Date.now() - this.connectionStartTime;
                this.latency = latency;
                this.latencyElement.textContent = `${latency} ms`;
                
                this.updateStatus('Test passed', 'connected');
                this.connectionInfo.textContent = `Connection successful! Latency: ${latency}ms`;
                this.showMessage(`Server is reachable (${latency}ms)`, 'success');
                
                // Close test connection
                setTimeout(() => testWs.close(), 100);
            };
            
            testWs.onerror = () => {
                clearTimeout(timeout);
                this.updateStatus('Test failed', 'error');
                this.connectionInfo.textContent = 'Cannot connect to server';
                this.showMessage('Server is not reachable', 'error');
            };
            
        } catch (error) {
            this.updateStatus('Test error', 'error');
            this.connectionInfo.textContent = `Error: ${error.message}`;
        }
    }
    
    handleVideoData(data) {
        this.frameCount++;
        this.frameCountElement.textContent = this.frameCount;
        
        // Update latency periodically
        if (this.frameCount % 60 === 0) {
            this.latency = Date.now() - this.connectionStartTime;
            this.latencyElement.textContent = `${this.latency} ms`;
            
            // Update connection quality based on frame rate
            this.updateConnectionQuality();
        }
        
        // Handle different types of video data
        if (data instanceof Blob) {
            // Binary blob data (MP4, WebM, etc.)
            if (data.type.includes('video') || data.type.includes('image')) {
                const videoUrl = URL.createObjectURL(data);
                this.videoPlayer.src = videoUrl;
            }
        } else if (typeof data === 'string') {
            // Base64 encoded data
            if (data.startsWith('data:video/') || data.startsWith('data:image/')) {
                this.videoPlayer.src = data;
            } else if (data.startsWith('{')) {
                // JSON data
                try {
                    const jsonData = JSON.parse(data);
                    if (jsonData.videoData) {
                        this.videoPlayer.src = jsonData.videoData;
                    }
                    if (jsonData.latency) {
                        this.latency = jsonData.latency;
                        this.latencyElement.textContent = `${jsonData.latency} ms`;
                    }
                } catch (e) {
                    // Not JSON, ignore
                }
            }
        } else if (data instanceof ArrayBuffer) {
            // ArrayBuffer data
            const blob = new Blob([data], { type: 'application/octet-stream' });
            const videoUrl = URL.createObjectURL(blob);
            this.videoPlayer.src = videoUrl;
        }
    }
    
    updateConnectionQuality() {
        if (!this.isConnected) {
            this.connectionQuality.textContent = '--';
            this.connectionQuality.className = 'stat-value quality-neutral';
            return;
        }
        
        // Simple quality indicator (you can enhance this based on actual metrics)
        let quality = 'Good';
        let qualityClass = 'quality-good';
        
        if (this.latency > 500) {
            quality = 'Poor';
            qualityClass = 'quality-poor';
        } else if (this.latency > 200) {
            quality = 'Fair';
            qualityClass = 'quality-fair';
        }
        
        this.connectionQuality.textContent = quality;
        this.connectionQuality.className = `stat-value ${qualityClass}`;
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
        this.testBtn.disabled = this.isConnected;
        this.serverInput.disabled = this.isConnected;
        this.endpointInput.disabled = this.isConnected;
        
        if (this.isConnected) {
            this.connectBtn.textContent = 'Connected';
            this.disconnectBtn.textContent = 'Disconnect';
        } else {
            this.connectBtn.textContent = 'Connect to Stream';
            this.disconnectBtn.textContent = 'Disconnected';
        }
    }
    
    showMessage(message, type = 'info') {
        // Create a temporary message element
        const messageEl = document.createElement('div');
        messageEl.className = `message message-${type}`;
        messageEl.textContent = message;
        
        // Style it
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
        
        // Remove after 3 seconds
        setTimeout(() => {
            messageEl.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                if (messageEl.parentNode) {
                    messageEl.parentNode.removeChild(messageEl);
                }
            }, 300);
        }, 3000);
        
        // Add CSS animations if not already present
        if (!document.querySelector('#message-animations')) {
            const style = document.createElement('style');
            style.id = 'message-animations';
            style.textContent = `
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes slideOut {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(100%); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new WebSocketVideoStreamer();
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    const streamer = new WebSocketVideoStreamer();
    streamer.disconnect();
});