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
      // Create Peer instance. If id is provided, tries to use it (good for reconnects, but risky if taken)
      // We let PeerJS assign a random ID for now to avoid collisions, or use a short code logic if we had a server.
      // For this serverless demo, we rely on the long ID.
      this.peer = new Peer(id || '');

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
        console.error(err);
        reject(err);
      });
    });
  }

  // Client: Connect to a Host ID
  connectToHost(hostId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.peer) return reject('Peer not initialized');

      const conn = this.peer.connect(hostId);
      
      conn.on('open', () => {
        console.log('Connected to Host');
        this.hostConnection = conn;
        this.setupConnectionEvents(conn);
        resolve();
      });

      conn.on('error', (err) => {
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
    }
  }

  private setupConnectionEvents(conn: DataConnection) {
    conn.on('data', (data) => {
      this.onMessage(data as NetworkMessage);
    });

    conn.on('close', () => {
      console.log('Connection closed:', conn.peer);
      this.connections = this.connections.filter(c => c !== conn);
      this.onDisconnect();
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
