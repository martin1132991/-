
import { Peer, DataConnection } from 'peerjs';
import { NetworkMessage } from '../types';

export class PeerService {
  private peer: Peer | null = null;
  private connections: DataConnection[] = []; // For Host
  private hostConnection: DataConnection | null = null; // For Client
  
  // Callbacks
  public onMessage: (msg: NetworkMessage) => void = () => {};
  public onPeerOpen: (id: string) => void = () => {};
  public onConnection: (conn: DataConnection) => void = () => {};
  public onDisconnect: () => void = () => {};

  // Initialize as Host or Client
  init(id?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Determine if we are on HTTPS. If so, PeerJS must use secure: true
      const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';

      // Use a robust list of free STUN servers to help punch through NATs (Mobile/WiFi connections)
      this.peer = new Peer(id || '', {
        secure: isSecure, // CRITICAL FIX FOR VERCEL/HTTPS
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478?transport=udp' }
          ]
        },
        debug: 1 // Reduce debug noise unless critical
      });

      this.peer.on('open', (id) => {
        console.log('My Peer ID is: ' + id);
        this.onPeerOpen(id);
        resolve(id);
      });

      this.peer.on('connection', (conn) => {
        console.log('Incoming connection from:', conn.peer);
        this.connections.push(conn);
        this.setupConnectionEvents(conn);
        this.onConnection(conn);
      });

      this.peer.on('error', (err) => {
        console.error('PeerJS Error:', err);
        // Don't reject here immediately as some errors are non-fatal
      });

      this.peer.on('disconnected', () => {
        console.log('Peer disconnected from signaling server');
      });
    });
  }

  // Client: Connect to a Host ID
  connectToHost(hostId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.peer) return reject('Peer not initialized');

      console.log('Attempting to connect to Host:', hostId);
      
      // Force JSON serialization for better compatibility
      const conn = this.peer.connect(hostId, {
        reliable: true,
        serialization: 'json'
      });
      
      const timeout = setTimeout(() => {
        if (!conn.open) {
          reject(new Error('Connection timed out (Firewall/NAT issue). Try using same WiFi.'));
        }
      }, 10000);

      conn.on('open', () => {
        clearTimeout(timeout);
        console.log('Connected to Host!');
        this.hostConnection = conn;
        this.setupConnectionEvents(conn);
        resolve();
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        console.error('Connection Error', err);
        reject(err);
      });
    });
  }

  // Host: Broadcast message to all clients
  broadcast(msg: NetworkMessage) {
    this.connections.forEach(conn => {
      if (conn.open) {
        conn.send(msg);
      }
    });
  }

  // Client: Send message to Host
  sendToHost(msg: NetworkMessage) {
    if (this.hostConnection && this.hostConnection.open) {
      this.hostConnection.send(msg);
    } else {
      console.warn('Cannot send to host, connection not open');
    }
  }

  private setupConnectionEvents(conn: DataConnection) {
    conn.on('data', (data) => {
      this.onMessage(data as NetworkMessage);
    });

    conn.on('close', () => {
      console.log('Connection closed:', conn.peer);
      this.connections = this.connections.filter(c => c !== conn);
      if (this.hostConnection === conn) {
        this.hostConnection = null;
      }
      this.onDisconnect();
    });
    
    conn.on('error', (err) => {
      console.error('DataConnection Error:', err);
    });
  }

  destroy() {
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.connections = [];
    this.hostConnection = null;
  }
}

export const peerService = new PeerService();
